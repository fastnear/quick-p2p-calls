use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, State, WebSocketUpgrade,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{mpsc, RwLock};
use tower_http::cors::CorsLayer;

type Tx = mpsc::UnboundedSender<Message>;

struct Room {
    peers: Vec<(usize, Tx)>,
    next_id: usize,
}

type Rooms = Arc<RwLock<HashMap<String, Room>>>;

#[derive(Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "kebab-case")]
enum ClientMsg {
    Join { call_id: String },
    Offer { sdp: serde_json::Value },
    Answer { sdp: serde_json::Value },
    IceCandidate { candidate: serde_json::Value },
    Leave,
}

#[derive(Serialize)]
#[serde(tag = "type")]
#[serde(rename_all = "kebab-case")]
enum ServerMsg {
    PeerJoined,
    Offer { sdp: serde_json::Value },
    Answer { sdp: serde_json::Value },
    IceCandidate { candidate: serde_json::Value },
    PeerLeft,
    Error { message: String },
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let rooms: Rooms = Arc::new(RwLock::new(HashMap::new()));
    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".into());

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(rooms);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .unwrap();
    println!("Signaling server on :{port}");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(rooms): State<Rooms>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, rooms, addr))
}

async fn handle_socket(socket: WebSocket, rooms: Rooms, addr: SocketAddr) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut my_room: Option<String> = None;
    let mut my_id: usize = 0;

    while let Some(Ok(msg)) = ws_rx.next().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };

        let client_msg: ClientMsg = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(_) => {
                let _ = send(&tx, &ServerMsg::Error {
                    message: "invalid message".into(),
                });
                continue;
            }
        };

        match client_msg {
            ClientMsg::Join { call_id } => {
                let mut rooms_w = rooms.write().await;
                let room = rooms_w.entry(call_id.clone()).or_insert_with(|| Room {
                    peers: Vec::new(),
                    next_id: 0,
                });

                if room.peers.len() >= 2 {
                    let _ = send(&tx, &ServerMsg::Error {
                        message: "room full".into(),
                    });
                    continue;
                }

                my_id = room.next_id;
                room.next_id += 1;
                let is_second = !room.peers.is_empty();

                if is_second {
                    if let Some((_, peer_tx)) = room.peers.first() {
                        let _ = send(peer_tx, &ServerMsg::PeerJoined);
                    }
                }

                room.peers.push((my_id, tx.clone()));
                my_room = Some(call_id.clone());
                println!("[{addr}] joined room {call_id} (peer #{my_id})");
            }
            ClientMsg::Offer { sdp } => {
                relay(&rooms, &my_room, my_id, &ServerMsg::Offer { sdp }).await;
            }
            ClientMsg::Answer { sdp } => {
                relay(&rooms, &my_room, my_id, &ServerMsg::Answer { sdp }).await;
            }
            ClientMsg::IceCandidate { candidate } => {
                relay(&rooms, &my_room, my_id, &ServerMsg::IceCandidate { candidate }).await;
            }
            ClientMsg::Leave => break,
        }
    }

    if let Some(room_id) = &my_room {
        println!("[{addr}] disconnected from room {room_id} (peer #{my_id})");
        let mut rooms_w = rooms.write().await;
        if let Some(room) = rooms_w.get_mut(room_id) {
            for (id, peer_tx) in &room.peers {
                if *id != my_id {
                    let _ = send(peer_tx, &ServerMsg::PeerLeft);
                }
            }
            room.peers.retain(|(id, _)| *id != my_id);
            if room.peers.is_empty() {
                rooms_w.remove(room_id);
            }
        }
    }
}

async fn relay(rooms: &Rooms, my_room: &Option<String>, my_id: usize, msg: &ServerMsg) {
    if let Some(room_id) = &my_room {
        let rooms_r = rooms.read().await;
        if let Some(room) = rooms_r.get(room_id) {
            let msg_type = serde_json::to_string(msg).unwrap_or_default();
            let msg_type = msg_type.split('"').nth(3).unwrap_or("?");
            println!("[relay] room={room_id} from=#{my_id} peers={} type={msg_type}", room.peers.len());
            for (id, peer_tx) in &room.peers {
                if *id != my_id {
                    let result = send(peer_tx, msg);
                    println!("[relay]   -> peer #{id}: {:?}", result.is_ok());
                }
            }
        } else {
            println!("[relay] room {room_id} not found!");
        }
    } else {
        println!("[relay] no room set for peer #{my_id}!");
    }
}

fn send(tx: &Tx, msg: &ServerMsg) -> Result<(), mpsc::error::SendError<Message>> {
    let json = serde_json::to_string(msg).unwrap();
    tx.send(Message::Text(json.into()))
}
