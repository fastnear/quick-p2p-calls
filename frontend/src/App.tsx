import { Routes, Route, Navigate } from "react-router-dom";
import { generateCallId } from "./lib/callId";
import CallPage from "./pages/CallPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/call/${generateCallId()}`} replace />} />
      <Route path="/call/:callId" element={<CallPage />} />
    </Routes>
  );
}
