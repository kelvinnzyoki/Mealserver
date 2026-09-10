// Vercel serverless entry point. Vercel auto-detects any file under /api
// as a function; exporting the Express app directly lets Vercel's Node
// runtime handle each request without us managing app.listen() ourselves —
// the same pattern already used for the FlowFit backend.
import { app } from "../src/app";

export default app;
