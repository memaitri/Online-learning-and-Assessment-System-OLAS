import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { classAPI, userAPI } from '../services/api';
import toast from 'react-hot-toast';

const ClassDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classData, setClassData] = useState(null);
  const [allStudents, setAllStudents] = useState([]);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'faculty') {
      navigate('/');
      return;
    }
    loadData();
  }, [id, user]);

  const loadData = async () => {
    try {
      const [classRes, usersRes] = await Promise.all([
        classAPI.getById(id),
        userAPI.getAll()
      ]);
      
      setClassData(classRes.data);
      setAllStudents(usersRes.data.filter(u => u.role === 'student'));
    } catch (error) {
      toast.error('Failed to load class data');
    }
  };

  const handleEnrollStudent = async (e) => {
    e.preventDefault();
    if (!selectedStudent) return;

    try {
      await classAPI.enrollStudent(id, selectedStudent);
      toast.success('Student enrolled successfully');
      setShowEnrollModal(false);
      setSelectedStudent('');
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to enroll student');
    }
  };

  const handleRemoveStudent = async (studentId) => {
    if (!confirm('Are you sure you want to remove this student?')) return;

    try {
      await classAPI.removeStudent(id, studentId);
      toast.success('Student removed successfully');
      loadData();
    } catch (error) {
      toast.error('Failed to remove student');
    }
  };

  if (!classData) {
    return <Layout><div>Loading...</div></Layout>;
  }

  const enrolledStudentIds = classData.students?.map(s => s.id) || [];
  const availableStudents = allStudents.filter(s => !enrolledStudentIds.includes(s.id));

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">{classData.name}</h1>
            <p className="text-gray-600">{classData.code}</p>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
          >
            Back
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-2">Description</h2>
          <p className="text-gray-700">{classData.description || 'No description provided'}</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Enrolled Students ({classData.students?.length || 0})</h2>
            <button
              onClick={() => setShowEnrollModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Enroll Student
            </button>
          </div>

          {classData.students?.length === 0 ? (
            <p className="text-gray-500">No students enrolled yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {classData.students.map((student) => (
                    <tr key={student.id}>
                      <td className="px-6 py-4 whitespace-nowrap">{student.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{student.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleRemoveStudent(student.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Faculty</h2>
          <div className="flex items-center space-x-3">
            <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
              Faculty
            </div>
            <div>
              <p className="font-semibold">{classData.faculty?.name}</p>
              <p className="text-sm text-gray-600">{classData.faculty?.email}</p>
            </div>
          </div>
        </div>

        {/* Enroll Student Modal */}
        {showEnrollModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-8 max-w-md w-full">
              <h2 className="text-2xl font-bold mb-4">Enroll Student</h2>
              <form onSubmit={handleEnrollStudent} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Select Student</label>
                  <select
                    value={selectedStudent}
                    onChange={(e) => setSelectedStudent(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  >
                    <option value="">Choose a student...</option>
                    {availableStudents.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.name} ({student.email})
                      </option>
                    ))}
                  </select>
                </div>
                {availableStudents.length === 0 && (
                  <p className="text-sm text-gray-500">All students are already enrolled in this class</p>
                )}
                <div className="flex space-x-3">
                  <button
                    type="submit"
                    disabled={availableStudents.length === 0}
                    className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    Enroll
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEnrollModal(false)}
                    className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default ClassDetail;
