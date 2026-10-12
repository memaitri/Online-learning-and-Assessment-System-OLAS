import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Classes from './pages/Classes';
import ClassDetail from './pages/ClassDetail';
import Exams from './pages/Exams';
import ExamTake from './pages/ExamTake';
import ExamEdit from './pages/ExamEdit';
import ExamMonitor from './pages/ExamMonitor';
import Users from './pages/Users';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/classes" element={<PrivateRoute><Classes /></PrivateRoute>} />
          <Route path="/classes/:id" element={<PrivateRoute><ClassDetail /></PrivateRoute>} />
          <Route path="/exams" element={<PrivateRoute><Exams /></PrivateRoute>} />
          <Route path="/exam/:id/take" element={<PrivateRoute><ExamTake /></PrivateRoute>} />
          <Route path="/exam/:id/edit" element={<PrivateRoute><ExamEdit /></PrivateRoute>} />
          <Route path="/exam/:id/monitor" element={<PrivateRoute><ExamMonitor /></PrivateRoute>} />
          <Route path="/users" element={<PrivateRoute><Users /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
