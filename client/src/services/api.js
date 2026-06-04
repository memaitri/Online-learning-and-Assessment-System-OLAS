import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (data) => api.post('/auth/register', data),
  getProfile: () => api.get('/auth/profile')
};

export const classAPI = {
  getAll: () => api.get('/classes'),
  getById: (id) => api.get(`/classes/${id}`),
  create: (data) => api.post('/classes', data),
  update: (id, data) => api.put(`/classes/${id}`, data),
  delete: (id) => api.delete(`/classes/${id}`),
  enrollStudent: (id, studentId) => api.post(`/classes/${id}/enroll`, { studentId }),
  removeStudent: (id, studentId) => api.delete(`/classes/${id}/students/${studentId}`)
};

export const examAPI = {
  getAll: (classId) => api.get('/exams', { params: { classId } }),
  getById: (id) => api.get(`/exams/${id}`),
  create: (data) => api.post('/exams', data),
  update: (id, data) => api.put(`/exams/${id}`, data),
  delete: (id) => api.delete(`/exams/${id}`),
  start: (id) => api.post(`/exams/${id}/start`),
  submit: (id) => api.post(`/exams/${id}/submit`),
  getSession: (id) => api.get(`/exams/${id}/session`),
  getSessions: (id) => api.get(`/exams/${id}/sessions`),
  unblockStudent: (examId, sessionId) => api.put(`/exams/${examId}/sessions/${sessionId}/unblock`)
};

export const codeAPI = {
  execute: (code, language, input) => api.post('/code/execute', { code, language, input })
};

export const submissionAPI = {
  create: (data) => api.post('/submissions', data),
  getByExam: (examId) => api.get(`/submissions/exam/${examId}`),
  getByStudent: (examId, studentId) => api.get(`/submissions/exam/${examId}/student/${studentId}`),
  grade: (id, score, feedback) => api.put(`/submissions/${id}/grade`, { score, feedback })
};

export const violationAPI = {
  create: (data) => api.post('/violations', data),
  getBySession: (sessionId) => api.get(`/violations/session/${sessionId}`),
  getByExam: (examId) => api.get(`/violations/exam/${examId}`),
  resetViolations: (sessionId) => api.delete(`/violations/session/${sessionId}`)
};

export const proctoringAPI = {
  start:     (examId)           => api.post('/proctoring/start',     { examId }),
  stop:      (examId)           => api.post('/proctoring/stop',      { examId }),
  frame:     (examId, frame)    => api.post('/proctoring/frame',     { examId, frame }),
  violation: (examId, type)     => api.post('/proctoring/violation', { examId, type }),
  status:    (examId)           => api.get('/proctoring/status',     { params: { examId } }),
  report:    (sessionId)        => api.get(`/proctoring/report/${sessionId}`),
};

export const userAPI = {
  getAll: () => api.get('/users'),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/auth/register', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`)
};

export default api;
