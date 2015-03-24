MusicManager = {
    peer: null,
    sharedCollection: null,
    localStorage: null,
    localCollection: null,
    downloads: null,

    initialize: function() {
        var self = this;
        var init = function() {
            Tracker.autorun(function() {
                var userId = Meteor.userId();
                if(!userId) {
                    Meteor.loginVisitor();
                }
                if(!self.peer) {
                    self.peer = new WebRTC(userId, { key: '62is9f6ozx2mx6r' });
                    self.synchronize(function(error) {
                        console.warn(error);
                    });
                }
            });
        }
        self.sharedCollection = Music;
        self.localCollection = new Ground.Collection('music', { connection: null });
        self.localStorage = new FilesystemStorage(init, function(error) {
            try {
                self.localStorage = new IndexedDBStorage();
            } catch(error) {
                self.localStorage = new TemporaryStorage();
                self.localCollection.remove({});
            }
            init();
        });
        self.downloads = async.queue(function(song, asyncCallback) {
            self.downloadSong(song, asyncCallback, asyncCallback);
        }, 1);
    },
    importSongs: function(files, successCallback, errorCallback) {
        var self = this;
        Session.set('currentImport', {});
        async.eachSeries(files, function(file, asyncCallback) {
            var currentImport = Session.get('currentImport');
            if(!currentImport.abort) {
                var path = file.webkitRelativePath || file.name;
                var meta = musicmetadata(file, { duration: true });
                meta.on('metadata', function(result) {
                    var song = {
                        'track': result.track.no,
                        'title': result.title,
                        'album': result.album,
                        'artist': result.artist[0],
                        'genre': result.genre[0],
                        'year': result.year,
                        'duration': result.duration,
                        'mime': file.type,
                        'extension': path.substr(path.lastIndexOf('.') + 1)
                    };
                    self.saveSong(song, file, function(id) {
                        self.pushSong(_.extend(song, { _id: id }));
                        asyncCallback();
                    }, function(error) {
                        if(error.name != 'InvalidModificationError') {
                            asyncCallback(error);
                        } else {
                            asyncCallback();
                        }
                    });
                }).on('done', function(error) {
                    if(error) {
                        asyncCallback();
                    }
                });
            } else {
                asyncCallback(new Error('Operation aborted.'));
            }
        }, function(error) {
            if(error) {
                if(errorCallback) {
                    errorCallback(error);
                }
            } else {
                if(successCallback) {
                    successCallback();
                }
            }
            Session.set('currentImport');
        });
    },
    pushSong: function(song, successCallback, errorCallback) {
        var self = this;
        if(window.chrome && window.navigator.vendor == 'Google Inc.' && parseInt(navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)[2]) >= 30) {
            Meteor.call('addSong', song, function(error, songId) {
                if(!error) {
                    if(successCallback) {
                        successCallback(_.extend(song, { '_id': songId }));
                    }
                } else if(errorCallback) {
                    errorCallback(error);
                }
            });
        }
    },
    requestSong: function(peerId, songId, successCallback, errorCallback, options) {
        var self = this;
        var conn = self.peer.request(peerId, songId, successCallback, errorCallback, options);
        if(!conn) {
        } else {
            conn.on('error', function(error) {
                errorCallback(error);
            });
        }
    },
    saveSong: function(song, file, successCallback,  errorCallback) {
        var self = this;
        self.localStorage.writeFile('{artist}/{album}/{track} {title}.{extension}'.format(song), file, function(url) {
            var id = self.localCollection.insert(_.extend(song, {
                url: url
            }));
            if(successCallback) {
                successCallback(id);
            }
        }, errorCallback);
    },
    downloadSong: function(song, successCallback, errorCallback) {
        var self = this;
        self.requestSong(song.owner, song._id, function(url) {
            var request = new XMLHttpRequest();
            request.open('GET', url, true); 
            request.responseType = 'blob';
            request.onerror = errorCallback;
            request.onload = function(event) {
                self.saveSong(_.omit(song, 'owner'), new Blob([this.response], { type: song.mime }), successCallback, errorCallback);
            }
            request.send();
        }, errorCallback, { action: 'download' });
    },
    synchronize: function(errorCallback) {
        var self = this;
        _.each(self.localCollection.find().fetch(), function(song) {
            self.pushSong(song, null, errorCallback);
        });
    },
    clear : function(successCallback, errorCallback) {
        var self = this;
        Meteor.call('clear', function(error, total) {
            if(!error) {
                self.localCollection.remove({});
                self.localStorage.clear(function() {
                    if(successCallback) {
                        successCallback();
                    }
                }, errorCallback);
            } else if(errorCallback) {
                errorCallback(error);
            }
        });
    }
}
