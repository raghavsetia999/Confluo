
import { BrowserRouter, Route, Routes } from "react-router-dom";

import AppLayout from "../components/layout/AppLayout";
import BoardListPage from "../features/boards/BoardListPage";
import CanvasPage from "../features/canvas/CanvasPage";

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<BoardListPage />} />
          <Route
            path="/boards/:boardId"
            element={<CanvasPage />}
          />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
