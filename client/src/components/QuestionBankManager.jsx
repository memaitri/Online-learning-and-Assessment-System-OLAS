import { useState, useEffect, useRef } from 'react';
import { questionBankAPI, examAPI } from '../services/api';
import toast from 'react-hot-toast';

/**
 * QuestionBankManager
 * ───────────────────
 * Full question-bank workflow embedded in the Faculty Dashboard:
 *   1. Upload .txt / .doc / .docx  → parse preview
 *   2. Edit / delete / add questions before saving
 *   3. Save to DB (QuestionBank table)
 *   4. Configure randomisation (questionsPerStudent, allowRepetition, seed)
 *   5. Assign → preview allocation table
 *   6. Export allocation as CSV
 *
 * Props
 * ─────
 *   examId  : string   – which exam this bank belongs to
 *   examTitle : string – shown in heading
 *   onClose : fn()     – close this panel
 */
const QuestionBankManager = ({ examId, examTitle, onClose }) => {
  // ── tabs ─────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState('bank'); // 'bank' | 'assign' | 'preview'

  // ── question bank state ───────────────────────────────────────────────────
  const [questions, setQuestions]       = useState([]);
  const [uploading, setUploading]       = useState(false);
  const [saving, setSaving]             = useState(false);
  const [editingIdx, setEditingIdx]     = useState(null);
  const [editBuf, setEditBuf]           = useState({});
  const fileRef                         = useRef();

  // ── randomisation config ──────────────────────────────────────────────────
  const [randomEnabled, setRandomEnabled]       = useState(false);
  const [questionsPerStudent, setQPerStudent]   = useState(1);
  const [allowRepetition, setAllowRepetition]   = useState(false);
  const [randomSeed, setRandomSeed]             = useState('');
  const [assigning, setAssigning]               = useState(false);

  // ── assignment preview ────────────────────────────────────────────────────
  const [assignments, setAssignments]   = useState([]);  // [{student, questions[]}]
  const [loadingPreview, setLoadingPreview] = useState(false);

  // ── load existing bank on mount ───────────────────────────────────────────
  useEffect(() => {
    loadBank();
    loadAssignments();
  }, [examId]);

  const loadBank = async () => {
    try {
      const res = await questionBankAPI.getBank(examId);
      setQuestions(res.data.questions || []);
    } catch { /* empty bank is fine */ }
  };

  const loadAssignments = async () => {
    try {
      const res = await questionBankAPI.getAssignments(examId);
      setAssignments(res.data.assignments || []);
      if ((res.data.assignments || []).length > 0) setRandomEnabled(true);
    } catch { /* no assignments yet */ }
  };

  // ── FILE UPLOAD ───────────────────────────────────────────────────────────
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await questionBankAPI.upload(fd);
      setQuestions(res.data.questions);
      toast.success(`${res.data.total} questions extracted — review and save`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // ── SAVE BANK ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (questions.length === 0) return toast.error('No questions to save');
    setSaving(true);
    try {
      const res = await questionBankAPI.save(examId, questions);
      setQuestions(res.data.questions);
      toast.success(`${res.data.total} questions saved to bank`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── INLINE EDIT ───────────────────────────────────────────────────────────
  const startEdit = (idx) => {
    setEditingIdx(idx);
    setEditBuf({ ...questions[idx] });
  };

  const commitEdit = async () => {
    const updated = [...questions];
    updated[editingIdx] = { ...updated[editingIdx], ...editBuf };
    setQuestions(updated);

    // If question has a DB id, persist immediately
    if (editBuf.id) {
      try {
        await questionBankAPI.updateQuestion(editBuf.id, {
          questionText: editBuf.questionText,
          title: editBuf.title,
          points: editBuf.points,
        });
      } catch { /* will be saved on next full-save */ }
    }
    setEditingIdx(null);
  };

  // ── DELETE QUESTION ───────────────────────────────────────────────────────
  const handleDelete = async (idx) => {
    const q = questions[idx];
    if (q.id) {
      try {
        await questionBankAPI.deleteQuestion(q.id);
      } catch (err) {
        toast.error('Failed to delete');
        return;
      }
    }
    const updated = questions.filter((_, i) => i !== idx).map((q, i) => ({
      ...q,
      questionNumber: i + 1,
    }));
    setQuestions(updated);
    toast.success('Question removed');
  };

  // ── ADD BLANK QUESTION ────────────────────────────────────────────────────
  const handleAddQuestion = () => {
    setQuestions([...questions, {
      questionNumber: questions.length + 1,
      questionText: '',
      title: '',
      points: 10,
    }]);
    setEditingIdx(questions.length);
    setEditBuf({ questionNumber: questions.length + 1, questionText: '', title: '', points: 10 });
  };

  // ── ASSIGN ────────────────────────────────────────────────────────────────
  const handleAssign = async () => {
    if (questions.length === 0) return toast.error('Save questions first');
    setAssigning(true);
    try {
      const res = await questionBankAPI.assign(examId, {
        questionsPerStudent,
        allowRepetition,
        randomSeed: randomSeed !== '' ? Number(randomSeed) : undefined,
      });
      setAssignments(res.data.preview);
      toast.success(`Assigned questions to ${res.data.totalStudents} students`);
      setTab('preview');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  };

  // ── CLEAR ASSIGNMENTS ─────────────────────────────────────────────────────
  const handleClearAssignments = async () => {
    if (!confirm('Clear all question assignments? Students will get new assignments on next assign.')) return;
    try {
      await questionBankAPI.clearAssignments(examId);
      setAssignments([]);
      setRandomEnabled(false);
      toast.success('Assignments cleared');
    } catch {
      toast.error('Failed to clear');
    }
  };

  // ── EXPORT CSV ────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (assignments.length === 0) return toast.error('No assignments to export');
    const rows = [['Student Name', 'Email', 'Q No', 'Question Text', 'Points']];
    for (const a of assignments) {
      for (const q of a.questions) {
        rows.push([
          a.student.name,
          a.student.email,
          `Q${q.questionNumber}`,
          `"${q.questionText.replace(/"/g, '""')}"`,
          q.points,
        ]);
      }
    }
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `assignment_report_${examId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl">
          <div>
            <h2 className="text-white text-xl font-bold">Question Bank Manager</h2>
            <p className="text-blue-200 text-sm mt-0.5">{examTitle}</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-blue-200 text-2xl font-bold">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-6">
          {[
            { key: 'bank',    label: `📚 Question Bank (${questions.length})` },
            { key: 'assign',  label: '🎲 Randomise & Assign' },
            { key: 'preview', label: `👁 Allocation Preview (${assignments.length} students)` },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── TAB: QUESTION BANK ── */}
          {tab === 'bank' && (
            <div className="space-y-4">
              {/* Upload area */}
              <div className="border-2 border-dashed border-blue-300 rounded-xl p-6 text-center bg-blue-50">
                <div className="text-4xl mb-2">📄</div>
                <p className="text-gray-600 font-medium mb-1">Upload a question file</p>
                <p className="text-gray-400 text-sm mb-4">Supports .txt, .doc, .docx — one question per line/block</p>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
                >
                  {uploading ? 'Extracting…' : 'Choose File'}
                </button>
                <input ref={fileRef} type="file" accept=".txt,.doc,.docx" onChange={handleFileChange} className="hidden" />
              </div>

              {/* Question list */}
              {questions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-gray-800">Questions ({questions.length})</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddQuestion}
                        className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg"
                      >
                        + Add Question
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-4 py-1.5 rounded-lg font-semibold"
                      >
                        {saving ? 'Saving…' : '💾 Save Bank'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600">
                          <th className="text-left px-3 py-2 border-b w-16">Q No</th>
                          <th className="text-left px-3 py-2 border-b">Question</th>
                          <th className="text-left px-3 py-2 border-b w-24">Title</th>
                          <th className="text-left px-3 py-2 border-b w-16">Points</th>
                          <th className="text-left px-3 py-2 border-b w-28">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {questions.map((q, idx) => (
                          <tr key={idx} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 font-bold text-blue-600">Q{q.questionNumber}</td>

                            {editingIdx === idx ? (
                              <>
                                <td className="px-3 py-2">
                                  <textarea
                                    value={editBuf.questionText}
                                    onChange={e => setEditBuf({ ...editBuf, questionText: e.target.value })}
                                    className="w-full border rounded p-1 text-sm resize-none"
                                    rows={2}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={editBuf.title}
                                    onChange={e => setEditBuf({ ...editBuf, title: e.target.value })}
                                    className="w-full border rounded p-1 text-sm"
                                    placeholder="Short title"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    value={editBuf.points}
                                    onChange={e => setEditBuf({ ...editBuf, points: Number(e.target.value) })}
                                    className="w-full border rounded p-1 text-sm"
                                    min={1}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <button onClick={commitEdit} className="text-green-600 hover:text-green-800 font-semibold mr-2">✓ Save</button>
                                  <button onClick={() => setEditingIdx(null)} className="text-gray-500 hover:text-gray-700">✕</button>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2 text-gray-800">{q.questionText}</td>
                                <td className="px-3 py-2 text-gray-500">{q.title}</td>
                                <td className="px-3 py-2 text-center">{q.points}</td>
                                <td className="px-3 py-2">
                                  <button onClick={() => startEdit(idx)} className="text-blue-600 hover:text-blue-800 mr-3 text-xs font-semibold">✏ Edit</button>
                                  <button onClick={() => handleDelete(idx)} className="text-red-600 hover:text-red-800 text-xs font-semibold">🗑 Del</button>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {questions.length === 0 && (
                <div className="text-center py-10 text-gray-400">
                  <div className="text-5xl mb-3">📭</div>
                  <p>No questions yet. Upload a file or add manually.</p>
                </div>
              )}
            </div>
          )}

          {/* ── TAB: RANDOMISE & ASSIGN ── */}
          {tab === 'assign' && (
            <div className="space-y-6 max-w-xl">
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
                <strong>📋 Question bank:</strong> {questions.length} question(s) saved.
                {questions.length === 0 && <span className="text-red-600"> Go to Question Bank tab and save questions first.</span>}
              </div>

              {/* Toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setRandomEnabled(!randomEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${randomEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${randomEnabled ? 'left-6' : 'left-0.5'}`} />
                </div>
                <span className="font-semibold text-gray-800">Enable Random Question Assignment</span>
              </label>

              {randomEnabled && (
                <div className="space-y-4 pl-1">
                  {/* Questions per student */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Questions Per Student
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={questions.length || 1}
                      value={questionsPerStudent}
                      onChange={e => setQPerStudent(Number(e.target.value))}
                      className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-1">Max {questions.length} (bank size)</p>
                  </div>

                  {/* Mode */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Assignment Mode</label>
                    <div className="space-y-2">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={!allowRepetition}
                          onChange={() => setAllowRepetition(false)}
                          className="mt-0.5"
                        />
                        <div>
                          <span className="text-sm font-medium">Mode 1 — Unique Assignment</span>
                          <p className="text-xs text-gray-400">No question repeats until all questions are exhausted.</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={allowRepetition}
                          onChange={() => setAllowRepetition(true)}
                          className="mt-0.5"
                        />
                        <div>
                          <span className="text-sm font-medium">Mode 2 — Allow Repetition</span>
                          <p className="text-xs text-gray-400">Multiple students can get the same question. Good for large cohorts.</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Seed */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Random Seed <span className="text-gray-400 font-normal">(optional — for reproducible distribution)</span>
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 42"
                      value={randomSeed}
                      onChange={e => setRandomSeed(e.target.value)}
                      className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-1">Same seed + same bank → identical allocation every time</p>
                  </div>

                  {/* Assign button */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleAssign}
                      disabled={assigning || questions.length === 0}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2.5 rounded-xl font-semibold transition-colors"
                    >
                      {assigning ? 'Assigning…' : '🎲 Assign Questions to Students'}
                    </button>
                    {assignments.length > 0 && (
                      <button
                        onClick={handleClearAssignments}
                        className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2.5 rounded-xl text-sm font-semibold"
                      >
                        Clear Assignments
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB: ALLOCATION PREVIEW ── */}
          {tab === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-800">
                  Allocation Preview — {assignments.length} students assigned
                </h3>
                <button
                  onClick={handleExportCSV}
                  disabled={assignments.length === 0}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-semibold"
                >
                  ⬇ Export CSV
                </button>
              </div>

              {assignments.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-5xl mb-3">📋</div>
                  <p>No assignments yet. Go to "Randomise & Assign" tab to generate.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-indigo-50 text-indigo-700">
                        <th className="text-left px-4 py-2 border-b">#</th>
                        <th className="text-left px-4 py-2 border-b">Student</th>
                        <th className="text-left px-4 py-2 border-b">Email</th>
                        <th className="text-left px-4 py-2 border-b">Assigned Question(s)</th>
                        <th className="text-left px-4 py-2 border-b w-16">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a, idx) => (
                        <tr key={a.student.id} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-2 font-semibold">{a.student.name}</td>
                          <td className="px-4 py-2 text-gray-500">{a.student.email}</td>
                          <td className="px-4 py-2">
                            {a.questions.map(q => (
                              <div key={q.id} className="flex items-start gap-2 mb-1">
                                <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-1.5 py-0.5 rounded whitespace-nowrap">Q{q.questionNumber}</span>
                                <span className="text-gray-700">{q.questionText.slice(0, 80)}{q.questionText.length > 80 ? '…' : ''}</span>
                              </div>
                            ))}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {a.questions.reduce((s, q) => s + (q.points || 0), 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-gray-50 rounded-b-2xl flex justify-end">
          <button
            onClick={onClose}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded-lg font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestionBankManager;
