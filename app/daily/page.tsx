import Royale from "../royale/client";
export const metadata = {
  title: "Daily challenge · Tic Tac Toe Royale",
  description: "One move. Three chances. Can you find today's winning move?",
};
export default function DailyPage() {
  return <Royale daily />;
}
