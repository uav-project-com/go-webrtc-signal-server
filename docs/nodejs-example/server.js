const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

io.on('connection', socket => {
  socket.on('join', room => {
    const clients = io.sockets.adapter.rooms.get(room);
    const numClients = clients ? clients.size : 0;

    if (numClients === 0) {
      socket.join(room);
      socket.emit('created');
    } else if (numClients === 1) {
      socket.join(room);
      socket.emit('joined');
      socket.to(room).emit('ready'); // Inform creator to start signaling
    } else {
      socket.emit('full');
    }
  });

  socket.on('signal', ({ room, data }) => {
    socket.to(room).emit('signal', data);
  });
});

server.listen(8080, () => {
  console.log('Server running at http://localhost:8080');
});