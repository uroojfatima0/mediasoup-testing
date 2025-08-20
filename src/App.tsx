import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import ProducerPage from "./pages/ProducerPage.tsx";
import ConsumerPage from "./pages/ConsumerPage";

export default function App() {
    return (
        <Router>
            <div className="p-4 bg-gray-900 text-white flex justify-between">
                <Link to="/produce" className="px-4">Producer</Link>
                <Link to="/consume" className="px-4">Consumer</Link>
            </div>
            <Routes>
                <Route path="/produce" element={<ProducerPage />} />
                <Route path="/consume" element={<ConsumerPage />} />
            </Routes>
        </Router>
    );
}
