#!/usr/bin/env node
"use strict";

var path = require("path"),
    request = require("request"),
    async = require("async"),
    _ = require("underscore"),
    assert = require("assert"),
    fs = require("fs"),
    pth = require("path");


var apiDriver = require("api-driver"),
    reporter_ = require("./lib/reporter");


var topics = [];
var openTopic;
var beforeFn = function() {};
var afterFn = function() {};

var Topic = function(description) {
    this.description = description || "";
    this._orderedStories = [];
    this._stories = {};
    this._orderedSteps = [];
    this._steps = {};
    this._stepDescriptions = {};
    this._beforeFn = function() {};
    this._afterFn = function() {};
};

// transform:
//
// [a, [b,c,[d],[e]],[f,g]] -> [[a,b,c,d], [a,b,c,e], [a,f,g]]
//
var toPaths = function(steps) {
    var paths = [];
    var _toPaths = function(steps, idx, path) {
        var step = steps[idx];
        if (_.isArray(step)) {
            _toPaths(step, 0, _.clone(path));
        } else {
            path.push(step);
        }

        if (steps[idx+1]) {
            _toPaths(steps, idx+1, path);
            return;
        }
        if (steps[idx+1] === null) {
            //deferred
            path.push(null);
        }
        // end of a path
        if (! _.isArray(step)) paths.push(path);
        return;
    };

    _toPaths(steps, 0, []);
    return paths;
};


Topic.prototype.setBefore = function(fn) {
    assert(_.isFunction(fn));
    this._beforeFn = fn;
};

Topic.prototype.setAfter = function(fn) {
    assert(_.isFunction(fn));
    this._afterFn = fn;
};

Topic.prototype.matchingStories = function(patterns) {
    var stories = this._orderedStories;
    return _.filter(stories, function(story) {
        return _.any( patterns, function(pat) {
            return pat.test(story.description);
        });
    });
};

var pathDesc = function(path) {
    var pathDesc = "";
    if (path[0].description !== "$body$") {
        var steps = _.filter(path, _.identity);
        pathDesc = _.pluck(steps, "description").join(" > ");
    }

    return pathDesc;
};

Topic.prototype.run = function(pathPatterns, before, after, stories, reporter, pathReporter, done) {
    var that = this;


    async.forEachSeries(stories, function(story, storyCb) {

        if (! story.steps) {
            console.log(story.description);
            console.log("  #### deferred ####");
            return storyCb();
        }

        reporter.story(story.description);
        console.log(story.description);

        var paths = toPaths(story.steps);
        if (pathPatterns) {
            paths = _.filter(paths, function(path) {
                var desc = pathDesc(path);
                return _.any(pathPatterns, function(pat) {
                    return pat.test(desc);
                });
            });
        }
        async.forEachSeries(paths, function(path, cb) {
            try {
                var driver = apiDriver.driver();

                reporter.beforeAll();
                before(driver);
                reporter.endBeforeAll();

                reporter.before();
                driver.wait();
                that._beforeFn(driver);
                reporter.endBefore();

                reporter.path();

                var stepDeferred = ! _.all(path, function(step) {

                    if ( ! step ) {
                        return false;
                    }

                    reporter.step(step.description, step.isFork);

                    driver.wait();

                    driver.scribingOn( reporter.getScribe() );
                    step.fn(driver);
                    driver.scribingOff();

                    reporter.endStep();
                    return true;
                });

                reporter.endPath();

                driver.results( function(err, expectationResults) {
                    var desc = pathDesc(path) + (stepDeferred ? " > ### deferred ###" : "");
                    pathReporter(err, desc, expectationResults);
                    cb();
                });

            } catch (e) {
                pathReporter(e, "");
                cb();
            }
        }, function() {

            that._afterFn();

            reporter.endStory();

            storyCb();

        });

    }, done);
};

Topic.prototype.addStory = function(story) {
    this._orderedStories.push(story);
};

var runTopics = function(opts, pathReporter, transcriptReporter, done) {

    // Only run stories that have a match in the supplied patterns
    var topics_ = _.filter(topics, function(t) {
        return ! opts.topics ||
               _.any( opts.topics, function(pat) { return pat.test(t.description); });
    });

    async.forEachSeries(topics_, function(topic, cb) {
        var stories = topic.matchingStories(opts.stories || [RegExp(".*")] );
        if (stories.length > 0) {
            var length = topic.description.length;
            var titlePad = 80 - length;
            console.log();
            console.log();
            console.log(Array(titlePad+1).join(" ") + topic.description);
            console.log(Array(80+1).join("-"));

            var reporter = reporter_.makeReporter(topic.description + " (stories)");
            topic.run(opts.paths, beforeFn, afterFn, stories, reporter, pathReporter, function() {
                transcriptReporter(reporter.transcript);
                cb();
            });
            return;
        }
        cb();
    }, done);
};


module.exports = {
    suite : function(description, fn) {
        openTopic = new Topic(description);
        fn();
        topics.push(openTopic);
        openTopic = null;
    },

    before : function(fn) {
        assert(_.isFunction(fn));
        if (openTopic) openTopic.setBefore(fn);
        else beforeFn = fn;
    },

    after : function(fn) {
        assert(_.isFunction(fn));
        if (openTopic) openTopic.setAfter(fn);
        else afterFn = fn;
    },

    test : function(description /*, function | steps... */) {
        var splat = _.rest(_.toArray(arguments));
        assert( _.isFunction(splat[0])
                || splat[0] === null
                || splat[0].what === "step",
                "Test takes a function or a step");
        var steps;

        if (_.isFunction(splat[0])) {
            // A test that is not broken into steps
            steps = [{
                what: "step",
                description: "$body$",
                fn: splat[0],
            }];
        } else if (! splat[0]) {
            steps = null;
        } else {
            steps = _.toArray(splat);
        }

        var story = {
            description: description,
            steps: steps
        };

        openTopic.addStory(story);

    },

    step : function(description, fn) {
        assert(_.isFunction(fn) || fn === null);

        return {
            what: "step",
            description: description,
            fn: fn,
        };
    },

    branch : function(/* steps... */) {
        return _.toArray(arguments);
    }

};


module.exports.beforeEach = module.exports.beforeEachPath;
module.exports.afterEach = module.exports.afterEachPath;
module.exports.expectations = require("api-driver/expectations");
module.exports.driverApi = require("api-driver").api;


if (! module.parent) {
    var program = require("commander"),
        minimatch = require("minimatch");

    var list = function(val) {
        return val.split(',');
    };

    var patterns = function(fnpat) {
        return _.map(list(fnpat), minimatch.makeRe );
    };

    var invertTest = function(pat) {
        return {
            test: function(val) {
                return (! pat.test(val));
            }
        };
    };

    var inversePatterns = function(fnpat) {
        return _.map(list(fnpat), function(fnpat) {
            return invertTest( minimatch.makeRe(fnpat) );
        });
    };


    program
        .version("0.0.1")
        .usage("[options] <configfile> <storyfiles...>")
        .option("-s, --suites <patterns,...>",
                "only run suites that match the fnmatch pattern",
                patterns)
        .option("-S, --not-suites <patterns,...>",
                "only run suites that do not match the fnmatch pattern",
                inversePatterns)
        .option("-t, --tests <patterns,...>",
                "only run tests that match the fnmatch pattern",
                patterns)
        .option("-T, --not-tests <patterns,...>",
                "only run tests that do not match the fnmatch pattern",
                inversePatterns)
        .option("-p, --paths <patterns,...>",
                "only run paths that match the fnmatch pattern",
                patterns)
        .option("-P, --not-paths <patterns,...>",
                "only run paths that do not match the fnmatch pattern",
                inversePatterns)
        .option("-o, --transcripts <dir>",
                "output directory for transcripts")
        .option("-c, --setup <file>",
                "Specify the setup file.  By default, stories looks for" +
                "stories_setup.js by starting from the path of the first" +
                "specifed test and searching up to the root.")
        .parse(process.argv);

    var outDir = program.transcripts;
    var testFiles = program.args;

    if (testFiles.length < 1) {
        program.outputHelp();
        process.exit(1);
    }

    program.topics = program.suites || program.notSuites;
    program.stories = program.tests || program.notTests;
    program.paths = program.paths || program.notPaths;

    var logRight = function(msg) {
        var colWidth = 80;
        var pad = colWidth - msg.length;
        var spaces = Array(pad+1).join(" ");
        console.log(spaces + msg);
    };

    var load = function(path) {
        if (path.slice(0,2) !== "." + pth.sep && path.slice(0,1) !== pth.sep) {
            path = "." + pth.sep + path;
        }
        require(pth.resolve(path));
    };

    var setupFile = program.setup;
    if (! setupFile) {
        var dirs = pth.resolve(testFiles[0]).split(path.sep).slice(0,-1);
        _.each(
            _.range(dirs.length)
            , function(i) {
                var f = _.first(dirs, dirs.length-i)
                        .concat(["stories_setup.js"])
                        .join(pth.sep);
                if (fs.existsSync(f)) {
                    setupFile = f;
                }
            }
        );
    }
    if (! setupFile) {
        console.log("warning: setup file not specified and not found");
    } else {
        load(setupFile);
    }

    var failed = false;
    var transcripts = [];
    var apiIndex = {
        commit: null,
        transcripts: transcripts
    };
    var expectationsPassed = 0;
    var expectationsFailed = 0;
    async.forEachSeries(testFiles, function(testFile, callback) {

        // give filename relative path for use with requires
        load(testFile);
        callback();

    }, function() {
        runTopics(

            program,

            // called for each path
            function(err, path, expectationResults) {
                if (err || expectationResults.expectationsFailed) {
                    //it's an error
                    console.log("  XX: " + path);
                    console.log();
                    console.log(err ? err.stack : expectationResults.err.stack);
                    console.log();
                    failed = true;
                } else {
                    var msg = path === "" ? "  ok" : "  ok: " + path;
                    console.log(msg);
                }
                if (expectationResults) {
                    expectationsPassed += expectationResults.expectationsPassed;
                    expectationsFailed += expectationResults.expectationsFailed;
                }
            },
            function(transcript) {
                if (! outDir) { return; }

                var outFile = path.basename(transcript.description.replace(/ /g, '_'), ".js") + ".json";
                fs.writeFileSync(outDir + "/" + outFile, JSON.stringify(transcript, null, 4));
                transcripts.push({desc: transcript.description, file: outFile});
            },
            // called when all done
            function() {
                if (outDir) {
                    fs.writeFileSync(outDir + "/index2.json", JSON.stringify(apiIndex, null, 4));
                }
                if (!failed) {
                    logRight("Expectations Passed: " + expectationsPassed);
                    logRight("ALL OK!");
                } else {
                    logRight("Expectations Failed: " + expectationsFailed);
                    logRight("FAILED!");
                    process.exit(1);
                }
            }
        );
    });
}
