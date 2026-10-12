import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { classAPI, examAPI, questionBankAPI } from '../services/api';
import toast from 'react-hot-toast';

// ── tiny seeded shuffle (same logic as backend) ──────────────────────────────
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rng = Math.random) {
  const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}

const BLANK_FORM = {
  title: '', description: '', classId: '',
  startTime: '', endTime: '', duration: 60,
  maxViolations: 3,
  allowedLanguages: ['javascript', 'python', 'java', 'c', 'cpp'],
  questions: [{ questionNumber: 1, title: '', description: '', points: 10, testCases: [] }],
  randomAssignment: false, questionsPerStudent: 1,
  allowRepetition: false, randomSeed: '',
};

const FacultyDashboard = () => {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const [classes, setClasses] = useState([]);
  const [exams,   setExams]   = useState([]);

  // modal state
  const [showModal,  setShowModal]  = useState(false);
  const [examForm,   setExamForm]   = useState({ ...BLANK_FORM });

  // upload state
  const [uploading, setUploading]   = useState(false);
  const fileRef = useRef();

  // randomise preview state
  const [assignPreview, setAssignPreview] = useState([]); // [{name,email,questions[]}]

  useEffect(() => {
    if (user?.role !== 'faculty') { navigate('/'); return; }
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const [cr, er] = await Promise.all([classAPI.getAll(), examAPI.getAll()]);
      setClasses(cr.data); setExams(er.data);
    } catch { toast.error('Failed to load data'); }
  };

  // ── form helpers ─────────────────────────────────────────────────────
  const set = (field, val) => setExamForm(p => ({ ...p, [field]: val }));

  const handleLangToggle = (lang) => {
    const cur = examForm.allowedLanguages;
    set('allowedLanguages', cur.includes(lang) ? cur.filter(l => l !== lang) : [...cur, lang]);
  };

  const addQuestion = () => setExamForm(p => ({
    ...p,
    questions: [...p.questions, { questionNumber: p.questions.length + 1, title: '', description: '', points: 10, testCases: [] }]
  }));

  const updQ = (idx, field, val) => {
    const q = [...examForm.questions]; q[idx][field] = val; set('questions', q);
  };

  const delQ = (idx) => {
    const q = examForm.questions.filter((_, i) => i !== idx).map((q, i) => ({ ...q, questionNumber: i + 1 }));
    set('questions', q);
  };

  // ── file upload → parse → populate questions list ─────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await questionBankAPI.upload(fd);
      const mapped = res.data.questions.map((q, i) => ({
        questionNumber: i + 1,
        title: q.title || q.questionText.slice(0, 60),
        description: q.questionText,
        points: q.points ?? 10, testCases: [],
      }));
      set('questions', mapped);
      toast.success(`${mapped.length} questions imported`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Parse failed');
    } finally { setUploading(false); e.target.value = ''; }
  };

  // ── live randomise preview (client-side, matches backend logic) ──────
  const buildPreview = () => {
    const { questions, questionsPerStudent, allowRepetition, randomSeed, classId } = examForm;
    const cls = classes.find(c => c.id === classId);
    if (!cls || !questions.length) return;
    const students = cls.students || [];
    if (!students.length) { toast.error('No students enrolled in this class'); return; }
    const n   = questionsPerStudent;
    const rng = randomSeed !== '' ? seededRng(Number(randomSeed)) : Math.random.bind(Math);
    const preview = students.map(s => {
      let pool;
      if (!allowRepetition && questions.length >= n) {
        pool = shuffle(questions, rng).slice(0, n);
      } else {
        pool = Array.from({ length: n }, () => questions[Math.floor(rng() * questions.length)]);
        pool = [...new Map(pool.map(q => [q.questionNumber, q])).values()];
      }
      return { name: s.name, email: s.email, questions: pool };
    });
    setAssignPreview(preview);
  };

  // ── submit ─────────────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...examForm,
        randomSeed: examForm.randomSeed !== '' ? Number(examForm.randomSeed) : null,
      };
      const res = await examAPI.create(payload);
      const newExamId = res.data.id;

      // If randomAssignment enabled: save bank + assign in background
      if (examForm.randomAssignment && examForm.questions.length > 0) {
        try {
          await questionBankAPI.save(newExamId, examForm.questions.map((q, i) => ({
            questionNumber: i + 1, questionText: q.description || q.title,
            title: q.title, points: q.points,
          })));
          await questionBankAPI.assign(newExamId, {
            questionsPerStudent: examForm.questionsPerStudent,
            allowRepetition: examForm.allowRepetition,
            randomSeed: examForm.randomSeed !== '' ? Number(examForm.randomSeed) : undefined,
          });
          toast.success('Exam created & questions assigned to students!');
        } catch (err) {
          toast.error('Exam created but assignment failed: ' + (err.response?.data?.message || err.message));
        }
      } else {
        toast.success('Exam created successfully');
      }

      setShowModal(false);
      setExamForm({ ...BLANK_FORM });
      setAssignPreview([]);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create exam');
    }
  };

  const getStatus = (exam) => {
    const now = new Date(), s = new Date(exam.startTime), e = new Date(exam.endTime);
    if (now < s) return { text: 'Upcoming', color: 'bg-blue-100 text-blue-800' };
    if (now > e) return { text: 'Ended',    color: 'bg-gray-100 text-gray-800' };
    return           { text: 'Active',    color: 'bg-green-100 text-green-800' };
  };

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Faculty Dashboard</h1>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-blue-500 text-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold">My Classes</h3>
            <p className="text-4xl font-bold mt-2">{classes.length}</p>
          </div>
          <div className="bg-green-500 text-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold">My Exams</h3>
            <p className="text-4xl font-bold mt-2">{exams.length}</p>
          </div>
          <div className="bg-purple-500 text-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold">Active Exams</h3>
            <p className="text-4xl font-bold mt-2">
              {exams.filter(e => { const n = new Date(); return n >= new Date(e.startTime) && n <= new Date(e.endTime); }).length}
            </p>
          </div>
        </div>

        {/* My Classes */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">My Classes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map(cls => (
              <div key={cls.id} className="border rounded-lg p-4">
                <h3 className="font-bold text-lg">{cls.name}</h3>
                <p className="text-sm text-gray-600">{cls.code}</p>
                <p className="text-sm mt-2">{cls.students?.length || 0} students enrolled</p>
                <button onClick={() => navigate(`/classes/${cls.id}`)} className="mt-3 text-blue-600 hover:text-blue-800 text-sm">View Details</button>
              </div>
            ))}
          </div>
        </div>

        {/* My Exams */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">My Exams</h2>
            <button onClick={() => { setExamForm({ ...BLANK_FORM }); setAssignPreview([]); setShowModal(true); }}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Create Exam
            </button>
          </div>
          <div className="space-y-3">
            {exams.map(exam => {
              const status = getStatus(exam);
              return (
                <div key={exam.id} className="border-l-4 border-blue-500 pl-4 py-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold text-lg">{exam.title}</h3>
                        <span className={`px-2 py-1 text-xs rounded-full ${status.color}`}>{status.text}</span>
                        {exam.randomAssignment && <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-700">🎲 Random</span>}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{exam.description}</p>
                      <div className="mt-2 text-sm text-gray-500 space-y-1">
                        <p>Class: {exam.class?.name} &nbsp;|&nbsp; Duration: {exam.duration} min &nbsp;|&nbsp; Questions: {exam.questions?.length || 0}</p>
                        <p>Start: {new Date(exam.startTime).toLocaleString()} &nbsp;|&nbsp; End: {new Date(exam.endTime).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex flex-col space-y-2 ml-4">
                      <button onClick={() => navigate(`/exam/${exam.id}/monitor`)} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 text-sm">Monitor Live</button>
                      <button onClick={() => navigate(`/exam/${exam.id}/edit`)}    className="bg-blue-600  text-white px-4 py-2 rounded hover:bg-blue-700  text-sm">Edit</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Create Exam Modal ─────────────────────────────────────────── */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 overflow-y-auto py-6">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4">

              {/* Header */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl px-6 py-4 flex justify-between items-center">
                <h2 className="text-white text-xl font-bold">Create New Exam</h2>
                <button onClick={() => setShowModal(false)} className="text-white text-2xl font-bold hover:text-blue-200">×</button>
              </div>

              <form onSubmit={handleCreate} className="p-6 space-y-5">

                {/* Title + Class */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Title</label>
                    <input type="text" value={examForm.title} onChange={e => set('title', e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Class</label>
                    <select value={examForm.classId} onChange={e => set('classId', e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                      <option value="">Select Class</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.name} ({c.students?.length || 0} students)</option>)}
                    </select>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700">Description</label>
                  <textarea value={examForm.description} onChange={e => set('description', e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg" rows="2" />
                </div>

                {/* Times + Duration */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Start Time</label>
                    <input type="datetime-local" value={examForm.startTime} onChange={e => set('startTime', e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">End Time</label>
                    <input type="datetime-local" value={examForm.endTime} onChange={e => set('endTime', e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Duration (min)</label>
                    <input type="number" value={examForm.duration} onChange={e => set('duration', parseInt(e.target.value))}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                  </div>
                </div>

                {/* Max Violations + Languages */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Max Violations</label>
                    <input type="number" min="1" value={examForm.maxViolations} onChange={e => set('maxViolations', parseInt(e.target.value))}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Allowed Languages</label>
                    <div className="flex flex-wrap gap-3 mt-1">
                      {['javascript','python','java','c','cpp'].map(lang => (
                        <label key={lang} className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={examForm.allowedLanguages.includes(lang)} onChange={() => handleLangToggle(lang)} className="rounded" />
                          <span className="text-sm">{lang}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── QUESTIONS SECTION ─────────────────────────────── */}
                <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-sm font-semibold text-gray-700">
                      Questions <span className="text-gray-400 font-normal">({examForm.questions.length})</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {/* Upload from file */}
                      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="flex items-center gap-1 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                        {uploading ? '⏳ Parsing…' : '📂 Upload File'}
                      </button>
                      <input ref={fileRef} type="file" accept=".txt,.doc,.docx" onChange={handleFileUpload} className="hidden" />
                      {/* Add manually */}
                      <button type="button" onClick={addQuestion}
                        className="text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-300 px-3 py-1.5 rounded-lg font-medium">
                        + Add Question
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">Upload a .txt / .doc / .docx to auto-fill, or add questions manually.</p>

                  {/* Question list */}
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {examForm.questions.map((q, idx) => (
                      <div key={idx} className="bg-white border border-gray-200 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">Q{idx + 1}</span>
                          {examForm.questions.length > 1 && (
                            <button type="button" onClick={() => delQ(idx)} className="text-red-500 hover:text-red-700 text-xs">✕ Remove</button>
                          )}
                        </div>
                        <input type="text" placeholder="Question Title (short)" value={q.title}
                          onChange={e => updQ(idx, 'title', e.target.value)}
                          className="block w-full px-2 py-1.5 border border-gray-200 rounded mb-1.5 text-sm" required />
                        <textarea placeholder="Full question description" value={q.description}
                          onChange={e => updQ(idx, 'description', e.target.value)}
                          className="block w-full px-2 py-1.5 border border-gray-200 rounded mb-1.5 text-sm resize-none" rows="2" />
                        <input type="number" placeholder="Points" value={q.points} min="1"
                          onChange={e => updQ(idx, 'points', parseInt(e.target.value))}
                          className="w-24 px-2 py-1.5 border border-gray-200 rounded text-sm" required />
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── RANDOMISE SECTION ─────────────────────────────── */}
                <div className="border border-purple-200 rounded-xl p-4 bg-purple-50">
                  {/* Toggle */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-purple-800">🎲 Random Question Assignment</p>
                      <p className="text-xs text-purple-500 mt-0.5">Automatically assign different questions to each student</p>
                    </div>
                    <button type="button" onClick={() => set('randomAssignment', !examForm.randomAssignment)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${examForm.randomAssignment ? 'bg-purple-600' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${examForm.randomAssignment ? 'left-6' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {examForm.randomAssignment && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {/* Questions per student */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Questions Per Student</label>
                          <input type="number" min="1" max={examForm.questions.length || 1}
                            value={examForm.questionsPerStudent}
                            onChange={e => set('questionsPerStudent', Number(e.target.value))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                          <p className="text-xs text-gray-400 mt-0.5">Max: {examForm.questions.length} (bank size)</p>
                        </div>
                        {/* Random seed */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">
                            Random Seed <span className="font-normal text-gray-400">(optional)</span>
                          </label>
                          <input type="number" placeholder="e.g. 42"
                            value={examForm.randomSeed}
                            onChange={e => set('randomSeed', e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                          <p className="text-xs text-gray-400 mt-0.5">Same seed → identical distribution</p>
                        </div>
                      </div>

                      {/* Mode */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-2">Assignment Mode</label>
                        <div className="flex gap-4">
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input type="radio" checked={!examForm.allowRepetition}
                              onChange={() => set('allowRepetition', false)} className="mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-gray-800">Mode 1 — Unique</p>
                              <p className="text-xs text-gray-400">No repeats until all questions used</p>
                            </div>
                          </label>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input type="radio" checked={examForm.allowRepetition}
                              onChange={() => set('allowRepetition', true)} className="mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-gray-800">Mode 2 — Allow Repeats</p>
                              <p className="text-xs text-gray-400">Good when students &gt; questions</p>
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Preview allocation button */}
                      <button type="button" onClick={buildPreview}
                        disabled={!examForm.classId || examForm.questions.length === 0}
                        className="w-full bg-white border-2 border-purple-400 text-purple-700 hover:bg-purple-50 disabled:opacity-50 py-2 rounded-lg text-sm font-semibold transition-colors">
                        👁 Preview Allocation
                      </button>

                      {/* Preview table */}
                      {assignPreview.length > 0 && (
                        <div className="border border-purple-200 rounded-lg overflow-hidden">
                          <div className="bg-purple-100 px-3 py-2 text-xs font-semibold text-purple-700">
                            Allocation Preview — {assignPreview.length} students
                          </div>
                          <div className="max-h-36 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-3 py-1.5 text-left text-gray-600">Student</th>
                                  <th className="px-3 py-1.5 text-left text-gray-600">Assigned Question(s)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {assignPreview.map((row, i) => (
                                  <tr key={i} className="border-t border-gray-100">
                                    <td className="px-3 py-1.5 font-medium">{row.name}</td>
                                    <td className="px-3 py-1.5 text-gray-600">
                                      {row.questions.map(q => (
                                        <span key={q.questionNumber} className="inline-flex items-center mr-2">
                                          <span className="bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded mr-1">Q{q.questionNumber}</span>
                                          {q.title?.slice(0, 35)}{q.title?.length > 35 ? '…' : ''}
                                        </span>
                                      ))}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Submit buttons ────────────────────────────────── */}
                <div className="flex gap-3 pt-2">
                  <button type="submit"
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors">
                    {examForm.randomAssignment ? '🎲 Create Exam & Assign Questions' : '✓ Create Exam'}
                  </button>
                  <button type="button" onClick={() => setShowModal(false)}
                    className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2.5 rounded-xl font-semibold text-sm transition-colors">
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

export default FacultyDashboard;
