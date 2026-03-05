import { nanoid } from "nanoid";

export function generateCallId(): string {
  return nanoid(8);
}
