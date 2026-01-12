// const { ApiError } = require('../exceptions/ApiError.js');

// export const errorMiddleware = (err, req, res, next) => {
//   const statusCode = err.statusCode || 500;

//   res.status(statusCode).json({
//     success: false,
//     message: err.message || 'Internal Server Error',
//     errors: err.errors || null,
//     stack:
//       process.env.NODE_ENV === 'development'
//         ? err.stack
//         : undefined,
//   });
// };
