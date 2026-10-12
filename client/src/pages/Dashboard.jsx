import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AdminDashboard from './AdminDashboard';
import FacultyDashboard from './FacultyDashboard';
import StudentDashboard from './StudentDashboard';

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  if (!user) {
    return null;
  }

  // Route to role-specific dashboard
  if (user.role === 'admin') {
    return <AdminDashboard />;
  }

  if (user.role === 'faculty') {
    return <FacultyDashboard />;
  }

  return <StudentDashboard />;
};

export default Dashboard;
