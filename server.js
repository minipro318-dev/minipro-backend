const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const pool = require("./config/db");
const prisma = require("./lib/prisma");
const { setupSocket } = require("./lib/socket");
const authRoutes = require("./routes/auth.routes");
const incidentRoutes = require("./routes/incident.routes");
const guardianInviteRoutes = require("./routes/guardian-invite.routes");
const { notFound, errorHandler } = require("./middleware/error");

dotenv.config();

if (!process.env.JWT_SECRET || !process.env.SESSION_SECRET) {
  throw new Error("JWT_SECRET and SESSION_SECRET must be configured.");
}

const app = express();
const PgSession = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new PgSession({ pool, tableName: "session", createTableIfMissing: false }),
    name: "safety.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.get("/", async (req, res, next) => {
  try {
    const result = await prisma.$queryRaw`SELECT NOW() AS time`;
    return res.json({ message: "Women safety backend is running.", time: result[0].time });
  } catch (error) {
    return next(error);
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/incidents", incidentRoutes);
app.use("/api/guardian-invites", guardianInviteRoutes);

app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
setupSocket(server);

const shutdown = async () => {
  server.close(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
