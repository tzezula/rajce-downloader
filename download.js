var http = require('http');
var fs = require('fs');
var pth = require('path');
var html = require('cheerio');
var js = require('esprima');

function index(indexUrl, err, success) {
	http.get(indexUrl, function(res) {
		if (res.statusCode == 200) {
			var page = "";
			res.on('data', function(data){
				page = page.concat(data);
			});
			res.on('end', function() {
				success && success(page);
			});
		} else {
			err && err(res.statusCode);
		}
	})
	.on('error', function(e){err && err(e.message);})
	.end();
}

function scan (node, sink) {
	if (sink(node)) {
		for (var p in node) {
			if (node.hasOwnProperty(p) && typeof(node[p]) === 'object' && node[p] !== null) {
				if (Array.isArray(node[p])) {
					node[p].forEach(function(subNode){scan(subNode, sink);});
				} else {
					scan(node[p], sink);
				}
			}
		} 
	}
}

function parseHTML(page) {
	var $ = html.load(page);
	var scripts = [];
	$('script').each(function(i) {
		scripts.push($(this).text());
	});
	var ast = js.parse(scripts.join('\n'));
	var names = null;
	var url = null;
	scan(ast, function(node) {
		if (node.type === 'VariableDeclarator') {
			if (node.id.name === 'photos') {
				names = [];
				if (node.init) {
					var active = false; 
					scan(node.init, function(node) {
						if (active) {
							if (node.type ==='Literal') {
								names.push(node.value);
							}
							active = false;
						} if (node.type === 'Identifier' && node.name==='fileName') {
							active = true;
						}
						return true;
					});
				}
			} else if (node.id.name === 'storage') {
				url = node.init && node.init.value ? node.init.value : '';
			}
		}
		return url == null || names == null;
	});
	return url === '' || names.length === 0 ?
	null :
	{
		storageURL: url,
		fileNames: names
	};
}

function parseURL(url) {
	var URL_RE = /^http(s)?:\/\/(([\w.])+)(:\d+)?(\/.*)$/;
	var res = URL_RE.exec(url);
	return res ?
	{
		hostname: res[2],
		port: res[4] ? parseInt(res[4]) : 80,
		path: res[5]
	}:
	null;
}

function createImagePath(base, fileName) {
	return base + "images/" + fileName; 
}

function download(dest, data, err, success) {
	var agent = new http.Agent({
		keepAlive: true,
		keepAliveMsecs: 10000,
		maxSockets: 1,
	});
	var storage = parseURL(data.storageURL);
	data.fileNames.forEach(function(fileName) {
		var options = {
			hostname: storage.hostname,
  			port: storage.port,
  			path: createImagePath(storage.path,fileName),
  			method: 'GET',
  			agent: agent
		};
		var req = http.request (options, function(res) {
			if (res.statusCode == 200) {
				var destFile = pth.resolve(dest,fileName);
		 		var stream = fs.createWriteStream(destFile);
		 		res.on('data', function(data) {
		 			stream.write(data);
		 		});
		 		res.on('end', function() {
		 			stream.close();
					success && success({
						url: createImagePath(data.storageURL,fileName),
						file: destFile
					});
		 		});
		 	} else {
				 err && err({
					 url: createImagePath(data.storageURL,fileName),
					 reason: res.statusCode
				 });
			}
		});
		req.on('error', function(e) {
			err && err({
					url: createImagePath(storage.path,fileName),
					reason: e.message
				});
		});
		req.end();
	});
}

function usage() {
	console.log("node download.js [-d folder] url ...");
}

function mkdirs(folder) {
	var pathElements = folder.split(pth.sep);
	var path = "";
	for (var i = 0; i< pathElements.length; i++) {
		path = path.concat(pathElements[i]).concat(pth.sep);
		if (!fs.existsSync(path)) {
			fs.mkdirSync(path);
		}
	}
}

var args = process.argv.slice(2);
if (args.length === 0) {
	usage();
}  else { 
	var urls = [];
	var dest = process.cwd();
	var expectDest = false;
	args.forEach(function(arg) {
		if (expectDest) {
			dest = arg;
			expectDest =  false;
		} else  if (arg === '-d') {
			expectDest = true;
		} else {
			urls.push(arg);
		}
	});
	if (expectDest || urls.length === 0) {
		usage();
	} else {
		mkdirs(dest);
		urls.forEach(function(arg) {
			index(
				arg,
				function(e) {console.log("Cannot load index: " + arg +", error: " + e);},
				function(page) {
					var data = parseHTML(page);
					if (data) {
						download(
							dest,
							data,
							function(e){
								console.log('Cannot open: ' + e.url + ', reason: '+ e.reason);
							},
							function(s){
								console.log(s.url + " --> " + s.file);
							});
					}
			});
		});
	}
}

