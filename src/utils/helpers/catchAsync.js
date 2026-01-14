module.exports = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch((err) => {
      // 🚨 LOG ERRORS CAUGHT BY catchAsync BEFORE PASSING TO ERROR HANDLER
      console.error('\n⚠️ ERROR CAUGHT BY catchAsync');
      console.error('  Error Name:', err?.name || 'Unknown');
      console.error('  Error Message:', err?.message || 'No message');
      console.error('  Error Code:', err?.code || 'No code');
      console.error('  Request Method:', req?.method);
      console.error('  Request URL:', req?.url);
      console.error('  Request Path:', req?.path);
      
      // Enhanced logging for ERR_INVALID_ARG_TYPE
      if (err?.message && err.message.includes('ERR_INVALID_ARG_TYPE')) {
        console.error('\n🚨🚨🚨 ERR_INVALID_ARG_TYPE CAUGHT BY catchAsync 🚨🚨🚨');
        console.error('  Full error:', err);
        if (err.stack) {
          console.error('  Stack trace:', err.stack);
        }
        if (req.file) {
          console.error('  req.file:', {
            fieldname: req.file.fieldname,
            path: req.file.path,
            pathType: typeof req.file.path,
            buffer: req.file.buffer ? 'present' : 'missing',
          });
        }
        if (req.files) {
          console.error('  req.files:', Array.isArray(req.files) ? `${req.files.length} files` : Object.keys(req.files).length + ' fields');
        }
      }
      
      // Pass to Express error handler
      next(err);
    });
  };
};
