import { executeCodeInSandbox } from '../sandbox/executor.js';

export const executeCode = async (req, res) => {
  try {
    const { code, language, input } = req.body;

    if (!code || !language) {
      return res.status(400).json({ message: 'Code and language are required' });
    }

    const result = await executeCodeInSandbox(code, language, input);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      message: 'Error executing code', 
      error: error.message,
      output: '',
      executionTime: 0
    });
  }
};
