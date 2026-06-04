import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { examAPI, codeAPI, submissionAPI, proctoringAPI } from '../services/api';
import { initSocket, disconnectSocket } from '../services/socket';
import ProctoringSystem from '../components/ProctoringSystem';
import WebcamProctor from '../components/WebcamProctor';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────────────────────────────────────────
// Risk level → Tailwind colour classes (matches Python engine levels)
// ─────────────────────────────────────────────────────────────────────────────
const RISK_LEVEL_STYLES = {
  SAFE:     'text-green-400',
  LOW:      'text-teal-400',
  MEDIUM:   'text-yellow-400',
  HIGH:     'text-orange-400',
  CRITICAL: 'text-red-500 animate-pulse',
};

const ExamTake = () => {
  const { id }      = useParams();
  const navigate    = useNavigate();

  // ── Exam / session state ─────────────────────────────────────────────
  const [exam, setExam]                   = useState(null);
  const [session, setSession]             = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [code, setCode]                   = useState('');
  const [language, setLanguage]           = useState('javascript');
  const [output, setOutput]               = useState('');
  const [input, setInput]                 = useState('');
  const [executing, setExecuting]         = useState(false);
  const [timeLeft, setTimeLeft]           = useState(0);
  const [isBlocked, setIsBlocked]         = useState(false);
  const [autoSaving, setAutoSaving]       = useState(false);
  const [fullscreenReady, setFullscreenReady] = useState(false);
  const [isSubmitting, setIsSubmitting]   = useState(false);

  // ── AI Proctoring state (Module 7 integration) ───────────────────────
  const [proctoringStarted, setProctoringStarted] = useState(false);
  const [proctoringReady,   setProctoringReady]   = useState(false); // Python detectors loaded
  const [riskData, setRiskData]           = useState(null);
  const [showFinalReport, setShowFinalReport] = useState(false);
  const [finalReport, setFinalReport]     = useState(null);

  // ── Handle real-time result from WebcamProctor ───────────────────────
  const handleFrameResult = useCallback((result) => {
    if (!result) return;
    console.log('[ExamTake] Frame result received:', result.riskScore, result.riskLevel, 'faces:', result.faceCount);
    setRiskData({
      riskScore:       result.riskScore       ?? 0,
      riskLevel:       result.riskLevel       ?? 'SAFE',
      totalViolations: result.totalViolations ?? 0,
      phoneDetections: result.phoneDetections ?? 0,
      multipleFaces:   result.multipleFaces   ?? 0,
      noFace:          result.noFace          ?? 0,
      lookingAway:     result.lookingAway     ?? 0,
      headTurns:       result.headTurns       ?? 0,
      gazeDirection:   result.gazeDirection   ?? 'UNKNOWN',
      headDirection:   result.headDirection   ?? 'UNKNOWN',
      faceCount:       result.faceCount       ?? 0,
      status:          result.status          ?? 'running',
    });
  }, []);

  // ── Refs ─────────────────────────────────────────────────────────────
  const socketRef           = useRef(null);
  const autoSaveInterval    = useRef(null);
  const pollInterval        = useRef(null);       // 5-second risk-status poll
  const hasSubmitted        = useRef(false);
  const proctoringSessionId = useRef(null);       // DB session ID used for proctoring

  // ─────────────────────────────────────────────────────────────────────
  // Enter fullscreen
  // ─────────────────────────────────────────────────────────────────────
  const enterFullscreen = async () => {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen)            await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen)    await el.mozRequestFullScreen();
      setFullscreenReady(true);
    } catch {
      toast.error('Fullscreen required. Please try again.');
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Start AI proctoring (POST /api/proctoring/start)
  // ─────────────────────────────────────────────────────────────────────
  const startProctoring = useCallback(async (examId) => {
    if (proctoringStarted) return;
    try {
      console.log('[ExamTake] Starting AI proctoring for exam:', examId);
      const res = await proctoringAPI.start(examId);
      console.log('[ExamTake] Proctoring start response:', res.data);
      setProctoringStarted(true);

      // Poll until Python reports "All detectors ready" via the status endpoint,
      // then set proctoringReady=true so WebcamProctor begins sending frames.
      console.log('[ExamTake] Waiting for Python detectors to initialise…');
      let attempts = 0;
      const readyPoll = setInterval(async () => {
        attempts++;
        try {
          const statusRes = await proctoringAPI.status(examId);
          const ready = statusRes.data?.proctoring?.ready;
          console.log(`[ExamTake] Readiness poll #${attempts}: ready=${ready}`);
          if (ready) {
            clearInterval(readyPoll);
            setProctoringReady(true);
            console.log('[ExamTake] Python detectors ready ✓ — frame capture will start');
          }
          if (attempts >= 30) {
            // Timeout after ~60s — start anyway so exam is not blocked
            clearInterval(readyPoll);
            setProctoringReady(true);
            console.warn('[ExamTake] Readiness timeout — starting frame capture anyway');
          }
        } catch (e) {
          console.warn('[ExamTake] Readiness poll error:', e.message);
        }
      }, 2000);

    } catch (err) {
      console.warn('[ExamTake] Could not start AI proctoring:', err.response?.data || err.message);
      // Still allow exam — browser proctoring always works
    }
  }, [proctoringStarted]);

  // ─────────────────────────────────────────────────────────────────────
  // Poll /api/proctoring/status every 5 seconds
  // ─────────────────────────────────────────────────────────────────────
  const startPolling = useCallback((examId) => {
    if (pollInterval.current) return;
    pollInterval.current = setInterval(async () => {
      try {
        const res = await proctoringAPI.status(examId);
        if (res.data?.proctoring?.liveData) {
          setRiskData(res.data.proctoring.liveData);
        }
      } catch {
        // Silently ignore poll failures — network blip shouldn't disrupt exam
      }
    }, 5000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current);
      pollInterval.current = null;
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // Stop AI proctoring and fetch final report
  // ─────────────────────────────────────────────────────────────────────
  const stopProctoringAndReport = useCallback(async (examId, dbSessionId) => {
    stopPolling();
    try {
      const stopRes = await proctoringAPI.stop(examId);
      const sid     = dbSessionId || proctoringSessionId.current;
      if (sid) {
        const reportRes = await proctoringAPI.report(sid);
        setFinalReport(reportRes.data);
        setShowFinalReport(true);
      }
      // Update risk panel with final data
      if (stopRes.data?.reportData) {
        setRiskData({ ...stopRes.data.reportData, status: 'completed' });
      }
    } catch (err) {
      console.warn('[ExamTake] Could not fetch proctoring report:', err.message);
    }
  }, [stopPolling]);

  // ─────────────────────────────────────────────────────────────────────
  // Mount
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadExam();
    socketRef.current = initSocket();
    if (socketRef.current) {
      socketRef.current.emit('join-exam', { examId: id });
    }

    autoSaveInterval.current = setInterval(handleAutoSave, 30000);

    return () => {
      clearInterval(autoSaveInterval.current);
      stopPolling();
      if (socketRef.current) {
        socketRef.current.emit('leave-exam', { examId: id });
        disconnectSocket();
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [id]);

  // ─────────────────────────────────────────────────────────────────────
  // Timer
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session || session.status !== 'in_progress' || !exam) return;
    const timer = setInterval(() => {
      const elapsed    = Math.floor((Date.now() - new Date(session.startedAt)) / 1000);
      const remaining  = (exam.duration * 60) - elapsed;
      if (remaining <= 0) {
        handleAutoSubmit('Time expired');
      } else {
        setTimeLeft(remaining);
        if (remaining === 300) toast.warning('5 minutes remaining!');
        if (remaining === 60)  toast.error('1 minute remaining!');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [session, exam]);

  // ─────────────────────────────────────────────────────────────────────
  // Start proctoring once session is loaded and fullscreen is ready
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session || !fullscreenReady || proctoringStarted) return;
    if (session.status !== 'in_progress') return;
    proctoringSessionId.current = session.id;
    startProctoring(id);
    startPolling(id);
  }, [session, fullscreenReady, proctoringStarted, id, startProctoring, startPolling]);

  // ─────────────────────────────────────────────────────────────────────
  // Load exam + session
  // ─────────────────────────────────────────────────────────────────────
  const loadExam = async () => {
    try {
      const [examRes, sessionRes] = await Promise.all([
        examAPI.getById(id),
        examAPI.getSession(id),
      ]);
      setExam(examRes.data);
      setSession(sessionRes.data);

      if (sessionRes.data?.status === 'blocked') {
        setIsBlocked(true);
        toast.error('You are blocked from this exam');
        setTimeout(() => navigate('/exams'), 2000);
        return;
      }
      if (sessionRes.data?.status === 'completed') {
        toast.info('You have already completed this exam');
        setTimeout(() => navigate('/exams'), 2000);
        return;
      }
      if (examRes.data.allowedLanguages?.length > 0) {
        setLanguage(examRes.data.allowedLanguages[0]);
      }
    } catch {
      toast.error('Failed to load exam');
      navigate('/exams');
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Auto-save
  // ─────────────────────────────────────────────────────────────────────
  const handleAutoSave = async () => {
    if (!code.trim() || !exam || hasSubmitted.current) return;
    setAutoSaving(true);
    try {
      await submissionAPI.create({
        examId: id,
        questionId: exam.questions[currentQuestion].questionNumber,
        code,
        language,
        output,
      });
      if (socketRef.current) {
        socketRef.current.emit('code-update', {
          examId: id,
          questionId: exam.questions[currentQuestion].questionNumber,
          code,
          language,
        });
      }
    } catch { /* silent */ }
    finally { setAutoSaving(false); }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Execute code
  // ─────────────────────────────────────────────────────────────────────
  const handleExecuteCode = async () => {
    setExecuting(true);
    setOutput('Executing...');
    try {
      const res = await codeAPI.execute(code, language, input);
      setOutput(res.data.output || res.data.error || 'No output');
      if (socketRef.current) {
        socketRef.current.emit('code-update', {
          examId: id,
          questionId: exam.questions[currentQuestion].questionNumber,
          code, language,
        });
      }
    } catch (err) {
      setOutput('Execution error: ' + (err.response?.data?.error || err.message));
    } finally {
      setExecuting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Save submission
  // ─────────────────────────────────────────────────────────────────────
  const handleSaveSubmission = async () => {
    if (hasSubmitted.current) return;
    try {
      await submissionAPI.create({
        examId: id,
        questionId: exam.questions[currentQuestion].questionNumber,
        code, language, output,
      });
      toast.success('Code saved successfully');
    } catch { toast.error('Failed to save code'); }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Auto-submit (time up / violations)
  // ─────────────────────────────────────────────────────────────────────
  const handleAutoSubmit = async (reason) => {
    if (hasSubmitted.current) return;
    hasSubmitted.current = true;
    setIsSubmitting(true);
    toast.info(`Auto-submitting: ${reason}`);
    try {
      if (code.trim()) {
        await submissionAPI.create({
          examId: id,
          questionId: exam.questions[currentQuestion].questionNumber,
          code, language, output,
        });
      }
      await examAPI.submit(id);   // this also stops proctoring server-side
      await stopProctoringAndReport(id, proctoringSessionId.current);
      toast.success('Exam submitted');
      setTimeout(() => navigate('/exams'), 3000);
    } catch {
      toast.error('Failed to submit exam');
      hasSubmitted.current = false;
      setIsSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Manual submit
  // ─────────────────────────────────────────────────────────────────────
  const handleSubmitExam = async () => {
    if (hasSubmitted.current) return;
    if (!confirm('Submit the exam? This cannot be undone.')) return;
    hasSubmitted.current = true;
    setIsSubmitting(true);
    try {
      if (code.trim()) await handleSaveSubmission();
      await examAPI.submit(id);   // stops Python proctoring server-side
      await stopProctoringAndReport(id, proctoringSessionId.current);
      toast.success('Exam submitted successfully');
      setTimeout(() => navigate('/exams'), 3000);
    } catch {
      toast.error('Failed to submit exam');
      hasSubmitted.current = false;
      setIsSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Violation / block callbacks
  // ─────────────────────────────────────────────────────────────────────
  const handleViolation = (count) => {
    if (count >= exam?.maxViolations) handleAutoSubmit('Excessive violations');
  };
  const handleBlock = () => {
    setIsBlocked(true);
    handleAutoSubmit('Blocked due to violations');
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ─────────────────────────────────────────────────────────────────────
  // Blocked screen
  // ─────────────────────────────────────────────────────────────────────
  if (isBlocked) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Access Blocked</h1>
          <p>You have been blocked from this exam due to violations.</p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Fullscreen gate
  // ─────────────────────────────────────────────────────────────────────
  if (!fullscreenReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6">🖥️</div>
          <h1 className="text-3xl font-bold mb-4">{exam ? exam.title : 'Exam'}</h1>
          <p className="text-gray-300 mb-2">This exam requires fullscreen mode.</p>
          <p className="text-gray-400 text-sm mb-2">
            AI proctoring monitors your webcam for face presence, phone usage, and gaze direction.
          </p>
          <p className="text-gray-400 text-sm mb-8">
            All actions are recorded. Violations affect your integrity score.
          </p>
          <button
            onClick={enterFullscreen}
            className="bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold px-10 py-4 rounded-xl transition-colors shadow-lg"
          >
            Enter Fullscreen &amp; Start Exam
          </button>
          {!exam && <p className="text-gray-500 text-sm mt-4">Loading exam details…</p>}
        </div>
      </div>
    );
  }

  if (!exam || !session) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center"><h1 className="text-2xl font-bold">Loading…</h1></div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Final report modal (shown after submit)
  // ─────────────────────────────────────────────────────────────────────
  if (showFinalReport && finalReport) {
    const r = finalReport;
    const level = r.riskLevel || 'SAFE';
    const levelStyle = RISK_LEVEL_STYLES[level] || 'text-gray-400';
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white p-6">
        <div className="bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full p-8 space-y-6">
          <div className="text-center">
            <div className="text-5xl mb-3">
              {r.integrityPassed !== false ? '✅' : '⚠️'}
            </div>
            <h1 className="text-2xl font-bold mb-1">Exam Submitted</h1>
            <p className="text-gray-400 text-sm">AI Proctoring Session Report</p>
          </div>

          <div className="bg-gray-900 rounded-xl p-5 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Risk Score</span>
              <span className={`text-2xl font-bold ${levelStyle}`}>
                {(r.riskScore ?? 0).toFixed(1)} / 100
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div
                className="h-3 rounded-full bg-current transition-all duration-700"
                style={{ width: `${Math.min(r.riskScore ?? 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Risk Level</span>
              <span className={`font-bold ${levelStyle}`}>{level}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Violations</span>
              <span className={r.totalViolations > 0 ? 'text-red-400 font-bold' : 'text-green-400'}>
                {r.totalViolations ?? 0}
              </span>
            </div>
            {r.phoneDetections > 0 && (
              <div className="flex justify-between text-sm text-red-400">
                <span>📱 Phone Detections</span><span>{r.phoneDetections}</span>
              </div>
            )}
            {r.multipleFaces > 0 && (
              <div className="flex justify-between text-sm text-red-400">
                <span>👥 Multiple Faces</span><span>{r.multipleFaces}</span>
              </div>
            )}
            {r.lookingAway > 0 && (
              <div className="flex justify-between text-sm text-yellow-400">
                <span>👁 Looking Away</span><span>{r.lookingAway}</span>
              </div>
            )}
            {r.headTurns > 0 && (
              <div className="flex justify-between text-sm text-yellow-400">
                <span>↩ Head Turns</span><span>{r.headTurns}</span>
              </div>
            )}
          </div>

          <p className="text-center text-gray-400 text-sm">
            Returning to exams list…
          </p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Main exam UI
  // ─────────────────────────────────────────────────────────────────────
  const question = exam.questions[currentQuestion];

  return (
    <div className="h-screen flex flex-col bg-gray-900">

      {/* AI + Browser proctoring panel (top-right) */}
      <ProctoringSystem
        sessionId={session.id}
        examId={id}
        onViolation={handleViolation}
        onBlock={handleBlock}
        socket={socketRef.current}
        disabled={isSubmitting}
        riskData={riskData}
      />

      {/* Webcam preview + frame capture (bottom-right) */}
      <WebcamProctor
        examId={id}
        onResult={handleFrameResult}
        disabled={isSubmitting}
        proctoringReady={proctoringReady}
      />

      {/* Header */}
      <div className="bg-gray-800 text-white px-6 py-3 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">{exam.title}</h1>
          <p className="text-sm text-gray-400">
            Question {currentQuestion + 1} of {exam.questions.length}
          </p>
        </div>
        <div className="flex items-center space-x-6">
          {/* Live risk badge in header */}
          {riskData && (
            <div className="flex items-center space-x-2 bg-gray-700 px-3 py-1 rounded-lg">
              <span className="text-xs text-gray-400">Risk</span>
              <span className={`text-sm font-bold ${RISK_LEVEL_STYLES[riskData.riskLevel] || 'text-gray-300'}`}>
                {(riskData.riskScore ?? 0).toFixed(0)}
              </span>
              <span className={`text-xs font-semibold ${RISK_LEVEL_STYLES[riskData.riskLevel] || 'text-gray-300'}`}>
                {riskData.riskLevel}
              </span>
            </div>
          )}
          {autoSaving && <span className="text-sm text-yellow-400">Saving…</span>}
          <span className={`text-lg font-mono ${timeLeft < 300 ? 'text-red-400 animate-pulse' : ''}`}>
            {formatTime(timeLeft)}
          </span>
          <button
            onClick={handleSubmitExam}
            disabled={hasSubmitted.current}
            className="bg-green-600 px-6 py-2 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors shadow-lg"
          >
            Submit Exam
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Question panel */}
        <div className="w-1/3 bg-gray-800 text-white p-6 overflow-y-auto">
          <div className="mb-6">
            <div className="flex space-x-2 mb-4 flex-wrap">
              {exam.questions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => { handleAutoSave(); setCurrentQuestion(idx); setCode(''); setOutput(''); }}
                  className={`px-3 py-1 rounded mb-2 ${idx === currentQuestion ? 'bg-blue-600' : 'bg-gray-700'}`}
                >
                  Q{idx + 1}
                </button>
              ))}
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2">Question {question.questionNumber}</h2>
          <h3 className="text-xl mb-4">{question.title}</h3>
          <p className="text-gray-300 mb-4 whitespace-pre-wrap">{question.description}</p>
          <p className="text-sm text-gray-400">Points: {question.points}</p>
          {question.testCases?.length > 0 && (
            <div className="mt-6">
              <h4 className="font-semibold mb-2">Test Cases:</h4>
              {question.testCases.map((tc, idx) => (
                <div key={idx} className="bg-gray-700 p-3 rounded mb-2 text-sm">
                  <p><span className="text-gray-400">Input:</span> {tc.input}</p>
                  <p><span className="text-gray-400">Expected:</span> {tc.expectedOutput}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Code editor */}
        <div className="flex-1 flex flex-col">
          <div className="bg-gray-800 px-4 py-2 flex items-center space-x-4">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-gray-700 text-white px-3 py-1 rounded"
            >
              {exam.allowedLanguages.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <button
              onClick={handleExecuteCode}
              disabled={executing || !code.trim()}
              className="bg-green-600 text-white px-4 py-1 rounded hover:bg-green-700 disabled:bg-gray-600"
            >
              {executing ? 'Running…' : 'Run Code'}
            </button>
            <button
              onClick={handleSaveSubmission}
              disabled={!code.trim()}
              className="bg-blue-600 text-white px-4 py-1 rounded hover:bg-blue-700 disabled:bg-gray-600"
            >
              Save
            </button>
          </div>

          <div className="flex-1">
            <Editor
              height="100%"
              language={language}
              value={code}
              onChange={(v) => setCode(v || '')}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
                automaticLayout: true,
                contextmenu: false,
                quickSuggestions: false,
                parameterHints: { enabled: false },
                suggestOnTriggerCharacters: false,
                acceptSuggestionOnCommitCharacter: false,
                tabCompletion: 'off',
                wordBasedSuggestions: false,
                selectionClipboard: false,
              }}
            />
          </div>

          {/* Output */}
          <div className="h-48 bg-gray-800 border-t border-gray-700">
            <div className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold flex justify-between items-center">
              <span>Output</span>
              <button onClick={() => setOutput('')} className="text-xs text-gray-400 hover:text-white">Clear</button>
            </div>
            <div
              className="p-4 text-white font-mono text-sm overflow-y-auto h-40"
              onCopy={(e) => e.preventDefault()}
              onCut={(e) => e.preventDefault()}
              onPaste={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              style={{ userSelect: 'none' }}
            >
              <pre className="whitespace-pre-wrap">{output || 'Run your code to see output…'}</pre>
            </div>
          </div>
        </div>
      </div>

      {/* Warning banner */}
      <div className="bg-yellow-600 text-white px-4 py-2 text-center text-sm">
        ⚠️ AI webcam proctoring is active. Do not switch tabs, exit fullscreen, or show prohibited items.
      </div>
    </div>
  );
};

export default ExamTake;
