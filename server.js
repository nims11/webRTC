var socket = require('socket.io').listen(8080);
socket.sockets.on('message', function (message) {
  log('Got message: ', message);
  socket.broadcast.emit('message', message);
});

