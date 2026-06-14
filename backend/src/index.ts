import express from 'express';
import cors from 'cors';
import routes from './routes/index';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

const app = express();

const allowedOrigins = new Set([
  'http://localhost:5173',
  env.frontendUrl,
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json());

app.use('/api', routes);

app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on port ${PORT}`);
});

export default app;
