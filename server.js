// all the module for basic routing and file serving as well as notification system

var http = require("http");
var express = require("express");
var path = require("path");
var app = express();
var server = http.createServer(app);
var io = require('socket.io').listen(server);

var exec = require('child_process').execFile;

var fun = function () {
	console.log("fun() start");
	exec('./stockfish/bin/stockfish.exe', ["position rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"], function (err, data) {
		console.log(err)
		console.log(data.toString());
	});
}
fun();


app.openGames = [];
app.runningGames = {};
app.clients = {};

// binding the url to the directory of the static files
app.use('/static', express.static(path.join(__dirname, '/static/')));

// serving the main page
app.get('/', function (req, res) {
	res.sendFile(__dirname + '/home.html');
});


io.on("connection", function (socket) {
	console.log("connection");

	// keeping the references to the sockets with the key as their socket IDs on the server, thus, clients are identified by socketID
	// note that the socket ID on the server is the same as socket ID on the client side, but with the prefix '/#'
	app.clients[socket.id] = socket;

	// Each client can create one game, whose details are in app.openGames at the index which is stored as the following property
	app.clients[socket.id].gameIndex = false;

	// serve the array to any client that requests the list.
	// fired after client has initiated the connection
	socket.on("get-list", function () {
		socket.emit("add-games", app.openGames);
	});

	// adding a new open game to list
	// fired when client creates/updates game
	socket.on("new-game", function (data) {
		if (app.clients[socket.id].gameIndex === false) {
			app.clients[socket.id].gameIndex = app.openGames.length;
			app.openGames.push(data);
			io.sockets.emit('add-games', data);
		} else {

			// if game already exists for the given client, update the data associated with it
			app.openGames[app.clients[socket.id].gameIndex] = data;
			io.sockets.emit('update-list', {
				'index': app.clients[socket.id].gameIndex,
				'game': data
			});
		}
	});

	// removing a game from list while keeping the remaining data consistent if a user disconnects and has created a game
	socket.on("disconnect", function () {
		app.openGames.splice(app.clients[socket.id].gameIndex, 1);

		for (var i in app.clients) {
			if (app.clients[i].gameIndex > app.clients[socket.id].gameIndex)
				app.clients[i].gameIndex -= 1;
		}

		// make sure all other clients update thier lists as well
		io.sockets.emit('remove-from-list', {
			'index': app.clients[socket.id].gameIndex
		});

		// remove disconnected client from the list of socket references
		delete app.clients[socket.id];
	});

	// fired when a user joins an already created game
	socket.on("join-game", function (data) {

		// add details to app.runningGames array, this will be useful when trasmitting move related data between the players
		// note that the key values DO NOT have '/#' prefix. This makes it suitable to directly feed client provided IDs
		app.runningGames[data.owner] = app.clients['/#' + data.opponent];
		app.runningGames[data.opponent] = app.clients['/#' + data.owner];

		data.owner = '/#' + data.owner;
		data.opponent = '/#' + data.opponent;

		// remove the game which will be started now
		var i = app.clients[data.owner].gameIndex;

		app.openGames.splice(i, 1);

		for (var x in app.clients) {
			if (app.clients[x].gameIndex > i)
				app.clients[x].gameIndex -= 1;
		}

		io.sockets.emit('remove-from-list', {
			'index': i
		});

		// if the joinee has a game as well, close it, since one user can only play one game at a time
		var j = app.clients[data.opponent].gameIndex;

		if (j || j == 0) {

			app.openGames.splice(j, 1);

			for (var x in app.clients) {
				if (app.clients[x].gameIndex > j)
					app.clients[x].gameIndex -= 1;
			}

			io.sockets.emit('remove-from-list', {
				'index': j
			});
		}

		// emit game-created event to both the clients, also send opponent data to owner
		app.clients[data.owner].emit("game-created", data.gameData);

		// no need to send data to the joinee as the client already knows about the owner
		app.clients[data.opponent].emit("game-created");
	});

	// whenever move is made, simply forward the data to the opponent by looking up the app.runningGames array
	socket.on("move-made", function (data) {
		app.runningGames[data.source].emit("move-made", data);
	});
});

// start server
server.listen(3000, function () {
	console.log("listening");
});
