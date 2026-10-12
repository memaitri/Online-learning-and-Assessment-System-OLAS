import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { examAPI, classAPI } from '../services/api';
import toast from 'react-hot-toast';

const ExamEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [examForm, setExamForm] = useState({
    title: '',
    description: '',
    classId: '',
    startTime: '',
    endTime: '',
    duration: 60,
    maxViolations: 3,
    allowedLanguages: ['javascript', 'python', 'java', 'c', 'cpp'],
    questions: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const [examRes, classesRes] = await Promise.all([
        examAPI.getById(id),
        classAPI.getAll()
      ]);
      
      const exam = examRes.data;
      setExamForm({
        title: exam.title,
        description: exam.description || '',
        classId: exam.classId,
        startTime: new Date(exam.startTime).toISOString().slice(0, 16),
        endTime: new Date(exam.endTime).toISOString().slice(0, 16),
        duration: exam.duration,
        maxViolations: exam.maxViolations,
        allowedLanguages: exam.allowedLanguages,
        questions: exam.questions || []
      });
      
      setClasses(classesRes.data);
    } catch (error) {
      toast.error('Failed to load exam');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await examAPI.update(id, examForm);
      toast.success('Exam updated successfully');
      navigate('/exams');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update exam');
    }
  };

  const handleLanguageToggle = (lang) => {
    const current = examForm.allowedLanguages;
    if (current.includes(lang)) {
      setExamForm({ ...examForm, allowedLanguages: current.filter(l => l !== lang) });
    } else {
      setExamForm({ ...examForm, allowedLanguages: [...current, lang] });
    }
  };

  const addQuestion = () => {
    setExamForm({
      ...examForm,
      questions: [...examForm.questions, {
        questionNumber: examForm.questions.length + 1,
        title: '',
        description: '',
        points: 10,
        testCases: []
      }]
    });
  };

  const updateQuestion = (index, field, value) => {
    const updated = [...examForm.questions];
    updated[index][field] = value;
    setExamForm({ ...examForm, questions: updated });
  };

  const removeQuestion = (index) => {
    const updated = examForm.questions.filter((_, i) => i !== index);
    // Renumber questions
    updated.forEach((q, i) => {
      q.questionNumber = i + 1;
    });
    setExamForm({ ...examForm, questions: updated });
  };

  if (loading) {
    return <Layout><div>Loading...</div></Layout>;
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Edit Exam</h1>
          <button
            onClick={() => navigate(-1)}
            className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Title</label>
              <input
                type="text"
                value={examForm.title}
                onChange={(e) => setExamForm({ ...examForm, title: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Class</label>
              <select
                value={examForm.classId}
                onChange={(e) => setExamForm({ ...examForm, classId: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              >
                <option value="">Select Class</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>{cls.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={examForm.description}
              onChange={(e) => setExamForm({ ...examForm, description: e.target.value })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              rows="2"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Start Time</label>
              <input
                type="datetime-local"
                value={examForm.startTime}
                onChange={(e) => setExamForm({ ...examForm, startTime: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">End Time</label>
              <input
                type="datetime-local"
                value={examForm.endTime}
                onChange={(e) => setExamForm({ ...examForm, endTime: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Duration (min)</label>
              <input
                type="number"
                value={examForm.duration}
                onChange={(e) => setExamForm({ ...examForm, duration: parseInt(e.target.value) })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Max Violations</label>
            <input
              type="number"
              value={examForm.maxViolations}
              onChange={(e) => setExamForm({ ...examForm, maxViolations: parseInt(e.target.value) })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md"
              min="1"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Allowed Languages</label>
            <div className="flex flex-wrap gap-2">
              {['javascript', 'python', 'java', 'c', 'cpp'].map((lang) => (
                <label key={lang} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={examForm.allowedLanguages.includes(lang)}
                    onChange={() => handleLanguageToggle(lang)}
                    className="rounded"
                  />
                  <span className="text-sm">{lang}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">Questions</label>
              <button
                type="button"
                onClick={addQuestion}
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                + Add Question
              </button>
            </div>
            {examForm.questions.map((q, idx) => (
              <div key={idx} className="border p-3 rounded mb-2">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-semibold">Question {idx + 1}</span>
                  {examForm.questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuestion(idx)}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Question Title"
                  value={q.title}
                  onChange={(e) => updateQuestion(idx, 'title', e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md mb-2"
                  required
                />
                <textarea
                  placeholder="Question Description"
                  value={q.description}
                  onChange={(e) => updateQuestion(idx, 'description', e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md mb-2"
                  rows="2"
                />
                <input
                  type="number"
                  placeholder="Points"
                  value={q.points}
                  onChange={(e) => updateQuestion(idx, 'points', parseInt(e.target.value))}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                  min="1"
                  required
                />
              </div>
            ))}
          </div>

          <div className="flex space-x-3">
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            >
              Update Exam
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 bg-gray-300 text-gray-700 py-2 rounded hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default ExamEdit;
