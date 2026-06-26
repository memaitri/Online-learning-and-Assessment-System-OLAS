import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { examAPI, codeAPI, submissionAPI, proctoringAPI, questionBankAPI } from '../services/api';
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
  const [proctoringReady,   setProctoringReady]   = useState(false);
  const [riskData, setRiskData]           = useState(null);
  const [showFinalReport, setShowFinalReport] = useState(false);
  const [finalReport, setFinalReport]     = useState(null);

  // ── Random question assignment ───────────────────────────────────────
  const [assignedQuestions, setAssignedQuestions] = useState(null);

  // ── Test results state ───────────────────────────────────────────────
  const [testResults,    setTestResults]    = useState(null);
  const [testRunning,    setTestRunning]    = useState(false);
  const [outputTab,      setOutputTab]      = useState('output'); // 'output' | 'tests'

  // ── Per-question submission tracking ────────────────────────────────
  // submittedQuestions: Set of questionNumber values already submitted
  const [submittedQuestions, setSubmittedQuestions] = useState(new Set());
  const [showExitModal,      setShowExitModal]      = useState(false);

  // ── Camera permission state ──────────────────────────────────────────
  // 'idle' | 'requesting' | 'granted' | 'denied' | 'error'
  const [camPermission, setCamPermission] = useState('idle');
  const [camStream, setCamStream]         = useState(null); // state so WebcamProctor prop updates
  const camStreamRef = useRef(null); // ref copy for cleanup access

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
  // Step 1-4: Request camera → verify stream → enter fullscreen
  // Called by the "Enter Fullscreen & Start Exam" button.
  // Exam start (steps 5-6) is handled by the existing useEffect that
  // watches session + fullscreenReady — nothing there is changed.
  // ─────────────────────────────────────────────────────────────────────
  const handleStartButton = async () => {
    // ── Step 1: Request camera permission ──────────────────────────────
    console.log('[Camera] Permission requested');
    setCamPermission('requesting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      const denied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      console.error('[Camera] Permission denied:', err.name, err.message);
      setCamPermission(denied ? 'denied' : 'error');
      return; // block exam start
    }

    // ── Step 2: Verify stream has an active video track ─────────────────
    const tracks = stream.getVideoTracks();
    if (!tracks.length || tracks[0].readyState !== 'live') {
      console.error('[Camera] Stream has no live video track');
      stream.getTracks().forEach(t => t.stop());
      setCamPermission('error');
      return;
    }
    console.log('[Camera] Permission granted');
    console.log('[Camera] Stream active —', tracks[0].label);
    setCamPermission('granted');

    // ── Step 3: Store stream so WebcamProctor can reuse it ─────────────
    // Stored in both state (triggers re-render so the prop is current)
    // and ref (for cleanup access without a stale closure).
    camStreamRef.current = stream;
    setCamStream(stream);

    // ── Step 4: Enter fullscreen ────────────────────────────────────────
    // Steps 5 (start proctoring) and 6 (begin frame uploads) are triggered
    // automatically by the existing useEffect on session + fullscreenReady.
    try {
      const el = document.documentElement;
      if (el.requestFullscreen)            await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen)    await el.mozRequestFullScreen();
      setFullscreenReady(true);
    } catch {
      toast.error('Fullscreen required. Please try again.');
      // Release the stream if fullscreen fails so user can retry cleanly
      stream.getTracks().forEach(t => t.stop());
      camStreamRef.current = null;
      setCamStream(null);
      setCamPermission('idle');
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
        const proctoring = res.data?.proctoring;
        console.log('[ExamTake:POLL] Status:', JSON.stringify({
          status: proctoring?.status,
          ready: proctoring?.ready,
          hasLiveData: !!proctoring?.liveData,
          riskScore: proctoring?.liveData?.riskScore,
          riskLevel: proctoring?.liveData?.riskLevel,
          faceCount: proctoring?.liveData?.faceCount,
          totalViolations: proctoring?.liveData?.totalViolations,
        }));
        if (proctoring?.liveData) {
          setRiskData(proctoring.liveData);
        }
      } catch (e) {
        console.warn('[ExamTake:POLL] Status poll error:', e.message);
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
        examAPI.start(id),
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

      // ── Fetch assigned questions (random assignment) ─────────────────
      try {
        const aqRes = await questionBankAPI.getMyQuestion(id);
        if (aqRes.data.assigned && aqRes.data.questions.length > 0) {
          // Map QuestionBank rows to the same shape as exam.questions
          const mapped = aqRes.data.questions.map((q, idx) => ({
            questionNumber: q.questionNumber,
            title: q.title || `Question ${q.questionNumber}`,
            description: q.questionText,
            points: q.points ?? 10,
            testCases: [],
            _bankId: q.id,
          }));
          setAssignedQuestions(mapped);
        } else {
          setAssignedQuestions([]); // no random assignment — use exam.questions
        }
      } catch {
        setAssignedQuestions([]); // fallback
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
    setOutputTab('output');
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
  // Submit Test — run code against each test case
  // ─────────────────────────────────────────────────────────────────────
  const handleTestCode = async () => {
    const testCases = question?.testCases ?? [];
    if (!code.trim()) return toast.error('Write some code first');

    // If no test cases defined, run once with empty input and show output
    if (testCases.length === 0) {
      toast('No test cases defined for this question — running with empty input');
      await handleExecuteCode();
      return;
    }

    setTestRunning(true);
    setOutputTab('tests');
    setTestResults(null);

    const results = [];
    for (const tc of testCases) {
      try {
        const res = await codeAPI.execute(code, language, tc.input ?? '');
        const actual   = (res.data.output || res.data.error || '').trim();
        const expected = (tc.expectedOutput ?? '').trim();
        const passed   = actual === expected;
        results.push({ input: tc.input, expected, actual, passed, error: res.data.error });
      } catch (err) {
        results.push({
          input: tc.input, expected: tc.expectedOutput ?? '',
          actual: 'Error: ' + (err.response?.data?.error || err.message),
          passed: false, error: true,
        });
      }
    }

    setTestResults(results);
    const passed = results.filter(r => r.passed).length;
    const total  = results.length;
    if (passed === total) toast.success(`All ${total} test cases passed! ✓`);
    else toast.error(`${passed}/${total} test cases passed`);
    setTestRunning(false);
  };

  // ─────────────────────────────────────────────────────────────────────
  // Save submission (silent auto-save draft — not the final submit)
  // ─────────────────────────────────────────────────────────────────────
  const handleSaveSubmission = async () => {
    if (hasSubmitted.current) return;
    try {
      await submissionAPI.create({
        examId: id,
        questionId: activeQuestions[currentQuestion]?.questionNumber ?? exam.questions[currentQuestion].questionNumber,
        code, language, output,
      });
      toast.success('Code saved successfully');
    } catch { toast.error('Failed to save code'); }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Submit Code — final submission for current question
  // Shows in faculty dashboard submissions table
  // ─────────────────────────────────────────────────────────────────────
  const handleSubmitCode = async () => {
    if (!code.trim()) { toast.error('Write some code before submitting'); return; }
    if (hasSubmitted.current) return;

    const qNum = activeQuestions[currentQuestion]?.questionNumber
              ?? exam.questions[currentQuestion]?.questionNumber;

    try {
      await submissionAPI.create({
        examId: id,
        questionId: qNum,
        code, language, output,
      });

      // Mark this question as submitted
      setSubmittedQuestions(prev => new Set([...prev, qNum]));
      toast.success(`Question ${qNum} submitted ✓`);

      // Emit live update to faculty monitor
      if (socketRef.current) {
        socketRef.current.emit('code-update', {
          examId: id, questionId: qNum, code, language,
        });
      }

      // Check if ALL questions are now submitted → offer to exit
      const allQNums = activeQuestions.map(q => q.questionNumber);
      const newSubmitted = new Set([...submittedQuestions, qNum]);
      const allDone = allQNums.every(n => newSubmitted.has(n));
      if (allDone) {
        setShowExitModal(true);
      } else {
        // Auto-advance to next unsubmitted question
        const nextIdx = activeQuestions.findIndex(
          (q, idx) => idx > currentQuestion && !newSubmitted.has(q.questionNumber)
        );
        if (nextIdx !== -1) {
          setCurrentQuestion(nextIdx);
          setCode('');
          setOutput('');
          setTestResults(null);
          toast(`Move to Question ${activeQuestions[nextIdx].questionNumber}`, { icon: '→' });
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit code');
    }
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
  // Fullscreen gate — camera permission + startup sequence
  // ─────────────────────────────────────────────────────────────────────
  if (!fullscreenReady) {
    // ── Camera denied modal ────────────────────────────────────────────
    if (camPermission === 'denied') {
      return (
        <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-6">📷</div>
            <h1 className="text-2xl font-bold mb-3 text-red-400">Camera Access Required</h1>
            <p className="text-gray-300 mb-2">
              Camera permission was denied. This examination requires webcam access for AI proctoring.
            </p>
            <p className="text-gray-400 text-sm mb-8">
              To fix this: click the camera icon in your browser's address bar and allow access, then retry.
            </p>
            <button
              onClick={() => setCamPermission('idle')}
              className="bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold px-10 py-4 rounded-xl transition-colors shadow-lg"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    // ── Camera error modal ─────────────────────────────────────────────
    if (camPermission === 'error') {
      return (
        <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-6">⚠️</div>
            <h1 className="text-2xl font-bold mb-3 text-yellow-400">Camera Unavailable</h1>
            <p className="text-gray-300 mb-2">
              Could not access your webcam. Make sure no other application is using it and try again.
            </p>
            <button
              onClick={() => setCamPermission('idle')}
              className="bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold px-10 py-4 rounded-xl transition-colors shadow-lg mt-6"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    // ── Main gate ──────────────────────────────────────────────────────
    const isRequesting = camPermission === 'requesting';
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6">🖥️</div>
          <h1 className="text-3xl font-bold mb-4">{exam ? exam.title : 'Exam'}</h1>
          <p className="text-gray-300 mb-2">This exam requires fullscreen mode and webcam access.</p>
          <p className="text-gray-400 text-sm mb-2">
            AI proctoring monitors your webcam for face presence, phone usage, and gaze direction.
          </p>
          <p className="text-gray-400 text-sm mb-8">
            All actions are recorded. Violations affect your integrity score.
          </p>

          {/* Camera status indicator */}
          <div className="flex items-center justify-center space-x-2 mb-6">
            <div className={`w-2.5 h-2.5 rounded-full ${
              camPermission === 'idle'       ? 'bg-gray-500' :
              camPermission === 'requesting' ? 'bg-yellow-400 animate-pulse' :
              camPermission === 'granted'    ? 'bg-green-400' : 'bg-red-500'
            }`} />
            <span className="text-sm text-gray-400">
              {camPermission === 'idle'       && 'Camera Required'}
              {camPermission === 'requesting' && 'Camera Connecting…'}
              {camPermission === 'granted'    && 'Camera Active'}
            </span>
          </div>

          <button
            onClick={handleStartButton}
            disabled={isRequesting}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-lg font-semibold px-10 py-4 rounded-xl transition-colors shadow-lg"
          >
            {isRequesting ? 'Requesting Camera…' : 'Enter Fullscreen & Start Exam'}
          </button>
          {!exam && <p className="text-gray-500 text-sm mt-4">Loading exam details…</p>}
        </div>
      </div>
    );
  }

  if (!exam || !session || assignedQuestions === null) {
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
  // ─────────────────────────────────────────────────────────────────────
  // Active question list: assigned questions take priority over exam.questions
  // ─────────────────────────────────────────────────────────────────────
  const activeQuestions = (assignedQuestions && assignedQuestions.length > 0)
    ? assignedQuestions
    : (exam?.questions ?? []);

  const question = activeQuestions[currentQuestion];

  return (
    <div className="h-screen flex flex-col bg-gray-900">

      {/* Full AI proctoring panel — fixed bottom-LEFT, never covers buttons or webcam */}
      <ProctoringSystem
        sessionId={session.id}
        examId={id}
        onViolation={handleViolation}
        onBlock={handleBlock}
        socket={socketRef.current}
        disabled={isSubmitting}
        riskData={riskData}
        inline={false}
      />

      {/* Webcam preview + frame capture (bottom-right, fixed) */}
      <WebcamProctor
        examId={id}
        onResult={handleFrameResult}
        disabled={isSubmitting}
        proctoringReady={proctoringReady}
        existingStream={camStream}
      />

      {/* ── Header ── */}
      <div className="bg-gray-800 text-white px-4 py-2 flex items-center gap-3 flex-wrap shrink-0">
        {/* Left: title + question count */}
        <div className="min-w-0">
          <h1 className="text-base font-bold truncate">{exam.title}</h1>
          <p className="text-xs text-gray-400">
            Q {currentQuestion + 1} / {activeQuestions.length}
          </p>
        </div>

        {/* Centre: proctoring status inline — never overlaps buttons */}
        <div className="flex items-center gap-2 flex-1">
          <ProctoringSystem
            sessionId={session.id}
            examId={id}
            onViolation={handleViolation}
            onBlock={handleBlock}
            socket={socketRef.current}
            disabled={isSubmitting}
            riskData={riskData}
            inline={true}
          />
        </div>        {/* Right: timer + Submit Exam */}
        <div className="flex items-center gap-3 ml-auto">
          {autoSaving && <span className="text-xs text-yellow-400">Saving…</span>}
          <span className={`text-base font-mono font-bold ${timeLeft < 300 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
            ⏱ {formatTime(timeLeft)}
          </span>
          <button
            onClick={handleSubmitExam}
            disabled={hasSubmitted.current}
            className="bg-green-600 px-4 py-1.5 rounded-lg text-sm font-bold hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            Finish Exam
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Question panel */}
        <div className="w-1/3 bg-gray-800 text-white p-6 overflow-y-auto">
          <div className="mb-6">
            <div className="flex space-x-2 mb-4 flex-wrap">
              {activeQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => { handleAutoSave(); setCurrentQuestion(idx); setCode(''); setOutput(''); setTestResults(null); }}
                  className={`px-3 py-1 rounded mb-2 text-sm font-medium relative ${
                    idx === currentQuestion
                      ? 'bg-blue-600 text-white'
                      : submittedQuestions.has(q.questionNumber)
                        ? 'bg-green-700 text-green-100'
                        : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                >
                  Q{idx + 1}{submittedQuestions.has(q.questionNumber) ? ' ✓' : ''}
                </button>
              ))}
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2">Question {question.questionNumber}</h2>
          {assignedQuestions && assignedQuestions.length > 0 && (
            <div className="inline-flex items-center gap-1 bg-indigo-900 border border-indigo-500 text-indigo-300 text-xs px-2 py-1 rounded-full mb-2">
              🔒 Randomly assigned to you
            </div>
          )}
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

          {/* ── Submit Code — always visible in question panel bottom ── */}
          <div className="mt-6 pt-4 border-t border-gray-700">
            {(() => {
              const qNum = activeQuestions[currentQuestion]?.questionNumber;
              const alreadySubmitted = submittedQuestions.has(qNum);
              const submittedCount   = submittedQuestions.size;
              const totalCount       = activeQuestions.length;
              return (
                <div className="space-y-2">
                  {/* Progress */}
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Submitted</span>
                    <span className={submittedCount === totalCount ? 'text-green-400 font-bold' : ''}>
                      {submittedCount} / {totalCount}
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5 mb-3">
                    <div
                      className="bg-green-500 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${(submittedCount / totalCount) * 100}%` }}
                    />
                  </div>

                  {/* Submit Code button */}
                  <button
                    onClick={handleSubmitCode}
                    disabled={!code.trim() || alreadySubmitted || isSubmitting}
                    className={`w-full py-2.5 rounded-lg font-bold text-sm transition-colors ${
                      alreadySubmitted
                        ? 'bg-green-800 text-green-300 cursor-default'
                        : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white shadow-lg'
                    }`}
                  >
                    {alreadySubmitted ? '✓ Code Submitted for Q' + qNum : '📤 Submit Code for Q' + qNum}
                  </button>

                  {/* Test button — only on last question */}
                  {currentQuestion === activeQuestions.length - 1 && !alreadySubmitted && (
                    <button
                      onClick={handleTestCode}
                      disabled={executing || testRunning || !code.trim()}
                      className="w-full py-2 rounded-lg font-semibold text-sm bg-yellow-500 hover:bg-yellow-400 text-gray-900 disabled:bg-gray-600 disabled:text-gray-400 transition-colors"
                    >
                      {testRunning ? '⏳ Running Tests…' : '🧪 Run Test Cases'}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Code editor */}
        <div className="flex-1 flex flex-col">
          <div className="bg-gray-800 px-4 py-2 flex items-center space-x-3">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-gray-700 text-white px-3 py-1 rounded"
            >
              {exam.allowedLanguages.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>

            {/* Run Code — free run with custom input */}
            <button
              onClick={handleExecuteCode}
              disabled={executing || testRunning || !code.trim()}
              className="bg-green-600 text-white px-4 py-1 rounded hover:bg-green-700 disabled:bg-gray-600 text-sm"
            >
              {executing ? 'Running…' : '▶ Run Code'}
            </button>

            {/* Submit Test — only on LAST question */}
            {currentQuestion === activeQuestions.length - 1 && (
              <button
                onClick={handleTestCode}
                disabled={executing || testRunning || !code.trim()}
                className="bg-yellow-500 text-gray-900 px-4 py-1 rounded hover:bg-yellow-400 disabled:bg-gray-600 disabled:text-white font-semibold text-sm"
              >
                {testRunning ? 'Testing…' : '🧪 Test'}
              </button>
            )}

            <div className="flex-1" />

            {/* Submit Code — final submission for this question (right side of toolbar) */}
            {(() => {
              const qNum = activeQuestions[currentQuestion]?.questionNumber;
              const alreadySubmitted = submittedQuestions.has(qNum);
              return (
                <button
                  onClick={handleSubmitCode}
                  disabled={!code.trim() || alreadySubmitted || isSubmitting}
                  className={`px-5 py-1.5 rounded font-bold text-sm transition-colors shadow ${
                    alreadySubmitted
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-orange-500 hover:bg-orange-600 text-white'
                  }`}
                >
                  {alreadySubmitted ? '✓ Submitted' : '📤 Submit Code'}
                </button>
              );
            })()}
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

          {/* Output + Test Results tabbed panel */}
          <div className="h-56 bg-gray-800 border-t border-gray-700 flex flex-col">

            {/* Tab bar */}
            <div className="flex items-center bg-gray-900 border-b border-gray-700 px-2">
              <button
                onClick={() => setOutputTab('output')}
                className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                  outputTab === 'output'
                    ? 'border-green-500 text-green-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Output
              </button>
              <button
                onClick={() => setOutputTab('tests')}
                className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1 ${
                  outputTab === 'tests'
                    ? 'border-yellow-400 text-yellow-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                🧪 Test Results
                {testResults && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ml-1 ${
                    testResults.every(r => r.passed) ? 'bg-green-700 text-green-200' : 'bg-red-700 text-red-200'
                  }`}>
                    {testResults.filter(r => r.passed).length}/{testResults.length}
                  </span>
                )}
              </button>
              <div className="ml-auto">
                <button onClick={() => { setOutput(''); setTestResults(null); }}
                  className="text-xs text-gray-500 hover:text-white px-2 py-1">Clear</button>
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Output tab ── */}
              {outputTab === 'output' && (
                <div
                  className="p-4 text-white font-mono text-sm h-full"
                  onCopy={e => e.preventDefault()} onCut={e => e.preventDefault()}
                  onPaste={e => e.preventDefault()} onContextMenu={e => e.preventDefault()}
                  style={{ userSelect: 'none' }}
                >
                  <pre className="whitespace-pre-wrap">{output || 'Run your code to see output…'}</pre>
                </div>
              )}

              {/* ── Test Results tab ── */}
              {outputTab === 'tests' && (
                <div className="p-3 space-y-2">
                  {testRunning && (
                    <div className="flex items-center gap-2 text-yellow-400 text-sm py-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                      Running test cases…
                    </div>
                  )}
                  {!testRunning && !testResults && (
                    <p className="text-gray-500 text-sm py-2">Click 🧪 Submit Test to run against test cases</p>
                  )}
                  {testResults && testResults.map((r, idx) => (
                    <div key={idx} className={`rounded-lg p-3 text-xs font-mono border ${
                      r.passed
                        ? 'bg-green-900 border-green-700 text-green-200'
                        : 'bg-red-900 border-red-700 text-red-200'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm">{r.passed ? '✅' : '❌'} Test {idx + 1}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          r.passed ? 'bg-green-700 text-green-100' : 'bg-red-700 text-red-100'
                        }`}>{r.passed ? 'PASSED' : 'FAILED'}</span>
                      </div>
                      {r.input !== undefined && r.input !== '' && (
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          <div>
                            <span className="text-gray-400">Input:</span>
                            <pre className="mt-0.5 whitespace-pre-wrap break-all">{r.input}</pre>
                          </div>
                          <div>
                            <span className="text-gray-400">Expected:</span>
                            <pre className="mt-0.5 whitespace-pre-wrap break-all text-green-300">{r.expected}</pre>
                          </div>
                          <div>
                            <span className="text-gray-400">Your Output:</span>
                            <pre className={`mt-0.5 whitespace-pre-wrap break-all ${r.passed ? 'text-green-300' : 'text-red-300'}`}>{r.actual}</pre>
                          </div>
                        </div>
                      )}
                      {(r.input === undefined || r.input === '') && (
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          <div><span className="text-gray-400">Expected:</span><pre className="mt-0.5 text-green-300">{r.expected}</pre></div>
                          <div><span className="text-gray-400">Your Output:</span><pre className={`mt-0.5 ${r.passed ? 'text-green-300' : 'text-red-300'}`}>{r.actual}</pre></div>
                        </div>
                      )}
                    </div>
                  ))}
                  {testResults && (
                    <div className={`text-center py-2 text-sm font-bold rounded-lg ${
                      testResults.every(r => r.passed) ? 'text-green-400 bg-green-900' : 'text-red-400 bg-red-900'
                    }`}>
                      {testResults.filter(r => r.passed).length} / {testResults.length} test cases passed
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Warning banner */}
      <div className="bg-yellow-600 text-white px-4 py-2 text-center text-sm">
        ⚠️ AI webcam proctoring is active. Do not switch tabs, exit fullscreen, or show prohibited items.
      </div>

      {/* ── All Questions Submitted → Exit Modal ── */}
      {showExitModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-8 text-center">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-white mb-2">All Questions Submitted!</h2>
            <p className="text-gray-300 mb-2">
              You have submitted code for all {activeQuestions.length} question{activeQuestions.length > 1 ? 's' : ''}.
            </p>
            <p className="text-gray-400 text-sm mb-6">
              Your submissions are visible to the faculty. You can now finish and exit the exam.
            </p>

            {/* Submitted summary */}
            <div className="bg-gray-900 rounded-xl p-4 mb-6 text-left space-y-1">
              {activeQuestions.map(q => (
                <div key={q.questionNumber} className="flex items-center gap-2 text-sm">
                  <span className="text-green-400 font-bold">✓</span>
                  <span className="text-gray-300">Q{q.questionNumber} — {q.title}</span>
                  <span className="ml-auto text-green-400 text-xs">Submitted</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowExitModal(false)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-3 rounded-xl font-semibold transition-colors"
              >
                Continue Reviewing
              </button>
              <button
                onClick={handleSubmitExam}
                disabled={isSubmitting}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white py-3 rounded-xl font-bold transition-colors"
              >
                {isSubmitting ? 'Finishing…' : '✓ Finish & Exit Exam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamTake;
