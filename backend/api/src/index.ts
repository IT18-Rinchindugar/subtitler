import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import authRouter from "./routes/auth";
import uploadRouter from "./routes/upload";
import projectsRouter from "./routes/projects";
import internalRouter from "./routes/internal";
import renderRouter from "./routes/render";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/internal", internalRouter);
app.use("/api/render", renderRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`API server running on port ${config.port}`);
});

export default app;
