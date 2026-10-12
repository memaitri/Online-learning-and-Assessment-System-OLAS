import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { examAPI, classAPI } from '../services/api';
import toast from 'react-hot-toast';

const StudentDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sessions, setSessions] = useState({});

  useEffect(() => {
    if (user?.role !== 'student') {
      navigate('/');
      return;
    }
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const [examsRes, classesRes] = await Promise.all([
        examAPI.getAll(),
        classAPI.getAll()
      ]);
      
      setExams(examsRes.data);
      setClasses(classesRes.data);
      
      // Load session status for each exam
      const sessionPromises = examsRes.data.map(exam => 
        examAPI.getSession(exam.id).catch(() => ({ data: null }))
      );
      const sessionResponses = await Promise.all(sessionPromises);
      const sessionMap = {};
      examsRes.data.forEach((exam, index) => {
        sessionMap[exam.id] = sessionResponses[index].data;
      });
      setSessions(sessionMap);
    } catch (error) {
      toast.error('Failed to load data');
    }
  };

  const getExamStatus = (exam) => {
    const now = new Date();
    const start = new Date(exam.startTime);
    const end = new Date(exam.endTime);

    if (now < start) {
      return { 
        text: 'Upcoming', 
        color: 'bg-blue-100 text-blue-800',
        canJoin: false,
        message: `Starts ${start.toLocaleString()}`
      };
    }
    if (now > end) {
      return { 
        text: 'Ended', 
        color: 'bg-gray-100 text-gray-800',
        canJoin: false,
        message: 'Exam has ended'
      };
    }
    return { 
      text: 'Active', 
      color: 'bg-green-100 text-green-800',
      canJoin: true,
      message: 'You can join now'
    };
  };

  const handleJoinExam = async (examId) => {
    try {
      // Request fullscreen
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      
      // Start exam
      await examAPI.start(examId);
      navigate(`/exam/${examId}/take`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to join exam');
    }
  };

  const upcomingExams = exams.filter(e => new Date(e.startTime) > new Date());
  const activeExams = exams.filter(e => {
    const now = new Date();
    return now >= new Date(e.startTime) && now <= new Date(e.endTime);
  });
  const pastExams = exams.filter(e => new Date(e.endTime) < new Date());

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Student Dashboard</h1>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-blue-500 text-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold">My Classes</h3>
            <p className="text-4xl font-bold mt-2">{classes.length}</p>
          </div>
          <div className="bg-green-500 text-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold">Active Exams</h3>
            <p className="text-4xl font-bold mt-2">{activeExams.length}</p>
          </div>
          <div className="bg-purple-500 text-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold">Upcoming Exams</h3>
            <p className="text-4xl font-bold mt-2">{upcomingExams.length}</p>
          </div>
        </div>

        {/* Active Exams - Priority */}
        {activeExams.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 border-2 border-green-500">
            <h2 className="text-xl font-bold mb-4 text-green-600">🔴 Active Exams - Join Now!</h2>
            <div className="space-y-4">
              {activeExams.map((exam) => {
                const status = getExamStatus(exam);
                return (
                  <div key={exam.id} className="border-l-4 border-green-500 pl-4 py-3 bg-green-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-bold text-lg">{exam.title}</h3>
                        <p className="text-sm text-gray-600 mt-1">{exam.description}</p>
                        <div className="mt-2 text-sm text-gray-700 space-y-1">
                          <p>Class: {exam.class?.name}</p>
                          <p>Duration: {exam.duration} minutes</p>
                          <p>Questions: {exam.questions?.length || 0}</p>
                          <p className="text-green-600 font-semibold">{status.message}</p>
                        </div>
                      </div>
                      {sessions[exam.id]?.status === 'completed' ? (
                        <div className="bg-blue-100 text-blue-800 px-6 py-3 rounded-lg font-semibold">
                          ✓ COMPLETED
                        </div>
                      ) : sessions[exam.id]?.status === 'blocked' ? (
                        <div className="bg-red-100 text-red-800 px-6 py-3 rounded-lg font-semibold">
                          ✗ BLOCKED
                        </div>
                      ) : sessions[exam.id]?.status === 'in_progress' ? (
                        <button
                          onClick={() => navigate(`/exam/${exam.id}/take`)}
                          className="bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-700 font-semibold"
                        >
                          CONTINUE EXAM
                        </button>
                      ) : (
                        <button
                          onClick={() => handleJoinExam(exam.id)}
                          className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-semibold animate-pulse"
                        >
                          JOIN EXAM
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming Exams */}
        {upcomingExams.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Upcoming Exams</h2>
            <div className="space-y-3">
              {upcomingExams.map((exam) => {
                const status = getExamStatus(exam);
                return (
                  <div key={exam.id} className="border-l-4 border-blue-500 pl-4 py-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-lg">{exam.title}</h3>
                          <span className={`px-2 py-1 text-xs rounded-full ${status.color}`}>
                            {status.text}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{exam.description}</p>
                        <div className="mt-2 text-sm text-gray-500 space-y-1">
                          <p>Class: {exam.class?.name}</p>
                          <p>Duration: {exam.duration} minutes</p>
                          <p>Start: {new Date(exam.startTime).toLocaleString()}</p>
                          <p>Questions: {exam.questions?.length || 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Past Exams */}
        {pastExams.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Past Exams</h2>
            <div className="space-y-3">
              {pastExams.map((exam) => (
                <div key={exam.id} className="border-l-4 border-gray-300 pl-4 py-3 opacity-75">
                  <h3 className="font-semibold">{exam.title}</h3>
                  <p className="text-sm text-gray-600">{exam.class?.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Ended: {new Date(exam.endTime).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My Classes */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">My Classes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => (
              <div key={cls.id} className="border rounded-lg p-4">
                <h3 className="font-bold text-lg">{cls.name}</h3>
                <p className="text-sm text-gray-600">{cls.code}</p>
                <p className="text-sm mt-2 text-gray-500">{cls.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Important Notice */}
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                <strong>Important:</strong> When joining an exam, you must allow fullscreen mode. 
                Switching tabs or exiting fullscreen will be recorded as a violation.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default StudentDashboard;
