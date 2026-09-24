import HomeView from "../components/customBets/Pages/Home";
import MarketFull from "../components/customBets/Pages/MarketFull";
import Bet from "../components/customBets/Pages/Bet";

export default function CustomBets({ view }) {
  if (view === "markets") return <MarketFull />;
  if (view === "bet") return <Bet />;
  return <HomeView />;
}