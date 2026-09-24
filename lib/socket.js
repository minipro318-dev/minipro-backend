const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const prisma = require("./prisma");

let ioInstance = null;

const rooms = {
  admin: "role:ADMIN",
  user: (userId) => `user:${userId}`,
  guardian: (guardianId) => `guardian:${guardianId}`,
};

const setupSocket = (server) => {
  ioInstance = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || true,
      credentials: true,
    },
  });

  ioInstance.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication token missing."));
    }

    try {
      socket.auth = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch {
      return next(new Error("Invalid authentication token."));
    }
  });

  ioInstance.on("connection", async (socket) => {
    const userId = Number(socket.auth.sub);
    const role = socket.auth.role;

    socket.join(rooms.user(userId));
    if (role === "ADMIN") {
      socket.join(rooms.admin);
    }
    if (role === "GUARDIAN") {
      socket.join(rooms.guardian(userId));
    }
  });

  return ioInstance;
};

const emitToAuthorizedRecipients = async ({ incident, eventName, payload }) => {
  if (!ioInstance) return;

  ioInstance.to(rooms.admin).emit(eventName, payload);
  ioInstance.to(rooms.user(incident.reportedById)).emit(eventName, payload);

  const links = await prisma.guardianLink.findMany({
    where: { endUserId: incident.reportedById },
    select: { guardianId: true },
  });

  for (const link of links) {
    ioInstance.to(rooms.guardian(link.guardianId)).emit(eventName, payload);
  }
};

module.exports = { setupSocket, emitToAuthorizedRecipients };
