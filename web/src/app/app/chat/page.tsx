import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import { ChatView } from "@/components/chat/ChatView";

export const metadata: Metadata = { title: "Chat · OpenStudy" };

export default function ChatPage() {
  return <ChatView />;
}
