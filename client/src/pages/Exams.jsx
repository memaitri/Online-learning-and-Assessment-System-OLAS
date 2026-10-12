import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { examAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

const Exams = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [sessions, setSessions] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExams();
  }, []);

  const loadExams = async () => {
    try {
      const response = await examAPI.getAll();
      setExams(response.data);
      
      // Load session status for each exam if student
      if (user?.role === 'student') {
        const sessionPromises = response.data.map(exam => 
          examAPI.getSession(exam.id).catch(() => ({ data: null }))
        );
        const sessionResponses = await Promise.all(sessionPromises);
        const sessionMap = {};
        response.data.forEach((exam, index) => {
          sessionMap[exam.id] = sessionResponses[index].data;
        });
        setSessions(sessionMap);
      }
    } catch (error) {
      toast.error('Failed to load exams');
    } finally {
      setLoading(false);
    }
  };

  const handleStartExam = async (examId) => {
    try {
      await examAPI.start(examId);
      navigate(`/exam/${examId}/take`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to start exam');
    }
  };

  const handleMonitorExam = (examId) => {
    navigate(`/exam/${examId}/monitor`);
  };

  const getExamStatus = (exam) => {
    const now = new Date();
    const start = new Date(exam.startTime);
    const end = new Date(exam.endTime);

    if (now < start) return { text: 'Upcoming', color: 'text-blue-600' };
    if (now > end) return { text: 'Ended', color: 'text-gray-600' };
    return { text: 'Active', color: 'text-green-600' };
  };

  if (loading) return <Layout><div>Loading...</div></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Exams</h1>

        <div className="space-y-4">
          {exams.map((exam) => {
            const status = getExamStatus(exam);
            return (
              <div key={exam.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900">{exam.title}</h3>
                    <p className="text-gray-600 mt-1">{exam.description}</p>
                    <div className="mt-3 space-y-1 text-sm text-gray-500">
                      <p>Class: {exam.class?.name} ({exam.class?.code})</p>
                      <p>Start: {new Date(exam.startTime).toLocaleString()}</p>
                      <p>Duration: {exam.duration} minutes</p>
                      <p>Questions: {exam.questions?.length || 0}</p>
                    </div>
                  </div>
                  <div className="ml-4 text-right">
                    <span className={`text-sm font-semibold ${status.color}`}>
                      {status.text}
                    </span>
                    <div className="mt-3 space-y-2">
                      {user?.role === 'student' && status.text === 'Active' && (
                        <>
                          {sessions[exam.id]?.status === 'completed' ? (
                            <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded text-center font-semibold">
                              ✓ Completed
                            </div>
                          ) : sessions[exam.id]?.status === 'blocked' ? (
                            <div className="bg-red-100 text-red-800 px-4 py-2 rounded text-center font-semibold">
                              ✗ Blocked
                            </div>
                          ) : sessions[exam.id]?.status === 'in_progress' ? (
                            <button
                              onClick={() => navigate(`/exam/${exam.id}/take`)}
                              className="block w-full bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700"
                            >
                              Continue Exam
                            </button>
                          ) : (
                            <button
                              onClick={() => handleStartExam(exam.id)}
                              className="block w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                            >
                              Start Exam
                            </button>
                          )}
                        </>
                      )}
                      {(user?.role === 'admin' || user?.role === 'faculty') && (
                        <>
                          <button
                            onClick={() => handleMonitorExam(exam.id)}
                            className="block w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                          >
                            Monitor
                          </button>
                          <button
                            onClick={() => navigate(`/exam/${exam.id}/edit`)}
                            className="block w-full bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
};

export default Exams;
