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


var depthFirst = function(step) {
    var paths = [];

    var _depthFirst = function(step, path) {
        path.push(step);
        if (! step || ! step.nextSteps || step.nextSteps.length === 0) {
            //leaf -- this is the end of a path
            paths.push(path);
            return;
        }
        _.each(step.nextSteps, function(c) {
                var newPath = _.clone(path);
                _depthFirst(c, newPath);
            });
    };

    _depthFirst(step, []);
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

        if (! story.root ) {
            console.log(story.description);
            console.log("  #### deferred ####");
            return storyCb();
        }

        reporter.story(story.description);
        console.log(story.description);

        var paths = depthFirst(story.root);
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

                var stepDeferred = false;
                _.each(path, function(step) {

                    if ( ! step ) {
                        stepDeferred = true;
                        return;
                    }

                    reporter.step(step.description, step.isFork);

                    driver.wait();

                    driver.scribingOn( reporter.getScribe() );
                    step.fn(driver);
                    driver.scribingOff();

                    reporter.endStep();

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


var linkSteps = function(steps) {
    assert(   steps.what === "step"
           || _.isArray(steps));
    if (steps.what === "step") return steps;
    var curStep = steps[0];
    _.any(_.rest(steps), function(step) {
        if (curStep === null) return true;
        if (_.isArray(step)) {
            curStep.nextSteps = step;
        } else {
            curStep.nextSteps = [step];
            curStep = step;
        }
    });

    return steps[0];
};

var config = {};

module.exports = {
    config : function(opts) {
        if (opts.endpoint) config.endpoint = opts.endpoint;
    },

    beforeEachPath : function(fn) {
        // console.log(fn.toString());
        assert(_.isFunction(fn));
        beforeFn = fn;
    },

    afterEachPath: function(fn) {
        // console.log(fn.toString());
        assert(_.isFunction(fn));
        afterFn = fn;
    },

    topic : function(description, fn) {
        openTopic = new Topic(description);
        fn();
        topics.push(openTopic);
        openTopic = null;
    },

    before : function(fn) {
        assert(_.isFunction(fn));
        openTopic.setBefore(fn);
    },

    after : function(fn) {
        assert(_.isFunction(fn));
        openTopic.setAfter(fn);
    },

    story : function(description, body) {
        assert( _.isFunction(body)
                || body === null
                || body.what === "step",
                "Story must be a function or a step");
        var step;
        if (_.isFunction(body)) {
            step = {
                what: "step",
                description: "$body$",
                fn: body,
                nextSteps: []
            };
        } else {
            step = body;
        }

        var story = {
            description: description,
            root: step
        };

        openTopic.addStory(story);
    },

    test : function(description /*, splat...*/) {
        var splat = _.rest(_.toArray(arguments));
        assert( _.isFunction(splat[0])
                || splat[0] === null
                || splat[0].what === "step",
                "Test takes a function or a step");
        var rootStep;
        if (_.isFunction(splat[0])) {
            rootStep = {
                what: "step",
                description: "$body$",
                fn: splat[0],
                nextSteps: []
            };
        } else {
            rootStep = linkSteps(splat);
        }

        var story = {
            description: description,
            root: rootStep
        };

        openTopic.addStory(story);

    },

    step : function(description, fn) {
        assert(_.isFunction(fn) || fn === null);

        var steps = [];
        if (fn !== null) {
            steps = _.toArray(arguments).slice(2);
            assert( _.all(steps, function(s) { return s === null || s.what === "step"; } ),
                    "Optional args to a step must be additional steps or null" );
            if (steps.length > 1) {
                _.map(steps, function(step) {
                    if (step) step.isFork = true;
                    return step;
                });
            }

            // other steps are deferred
            var last = steps.indexOf(null);
            if (last !== -1) {
                steps = steps.slice(0, last+1);
            }
        }

        return {
            what: "step",
            description: description,
            fn: fn,
            nextSteps: steps
        };
    },

    branch : function(/* branches... */) {
        var nextSteps = [];
        _.each(_.toArray(arguments), function(steps) {
            nextSteps.push(_.extend(linkSteps(steps), {isFork: true}));
        });
        return nextSteps;
    }

};


module.exports.suite = module.exports.topic;
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
        .option("-e, --endpoint <dir>",
                "Url for the base path of the api.  If path portion is " +
                "included, e.g. /api/v1/, it will be appended to " +
                "all requests.")
        .option("-c, --setup <dir>",
                "Location of the setup file.  By default, stories from the " +
                "the first test file and checks each folder " +
                "up to the root for 'stories_setup.js')")
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

    // load(testFiles[0]); // first file is the config file
    // testFiles = _.rest(testFiles);

    // command line overrides config
    if (program.endpoint) config.endpoint = program.endpoint;

    request(config.endpoint+"/version", function(err, resp, body) {

        var failed = false;
        var commitSHA;
        try {
            commitSHA = JSON.parse(body).commit;
            assert(commitSHA);
        } catch(e) {
            console.error("warning: api version string not found");
        }
        var transcripts = [];
        var apiIndex = {
            commit: commitSHA,
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
    });
}
