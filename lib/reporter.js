"use strict";

var noop = function() {};

var deepClone = function(obj) {
    // Must clone every object you scribe, lest you be mightily
    // confused when some test changes it from beneath you.
    return JSON.parse(JSON.stringify(obj, null, 2));
};

var makeScribe = function(transcript) {
    var self = {};

    self.deferredRequest = function() {
        var action = {};
        transcript.actions.push(action);
        return function(actor, req, res, body) {
            action.actor = actor;
            action.request = deepClone(req);
            action.response = {
                statusCode : res && res.statusCode,
                body : body
            };
        };
    };

    self.doc = function(message) {
        var nextAction = transcript.actions.length;
        var docStrings = transcript.docStrings[nextAction] || [];
        docStrings.push(message);
        transcript.docStrings[nextAction] = docStrings;
    };

    return self;
};

var makeReporter = function( topic ) {
    var self = {};
    var testScriptlet, pathdesc, depth, context;
    var pastSteps = [];

    var transcript = {what: "stories"};
    transcript.description = topic;
    transcript.stories = [];



    self.beforeAll = function() {
        testScriptlet = {};
        testScriptlet.actions = [];
        //we're not actually going keep this around, so don't attach it to the transcript
    };

    self.endBeforeAll = noop;

    self.before = function() {
        //only record this once; should be same every time
        if (transcript.setup) {
            return;
        }
        testScriptlet = {};
        testScriptlet.actions = [];
        transcript.setup = testScriptlet;
    };

    self.endBefore = noop;

    self.story = function(description) {
        context = {};
        context.description = description;
        context.actions = [];
        context.docStrings = {};
        transcript.stories.push(context);
    };

    self.endStory = function() {
        context = null;
    };

    self.path = function() {
        pathdesc = context.description;
        depth = 0;
    };

    self.endPath = function() {
        pathdesc = "";
        depth = 0;
    };

    self.step = function(description, isFork) {
        testScriptlet = {};
        testScriptlet.description = description;
        testScriptlet.depth = depth;
        testScriptlet.isFork = isFork;
        testScriptlet.actions = [];
        testScriptlet.docStrings = {};

        pathdesc = pathdesc + ">" + description;
        depth += 1;

        // We only want to report this step the first time it is hit
        if (pastSteps.indexOf(pathdesc) === -1) {
            pastSteps.push(pathdesc);
            context.steps = context.steps || [];
            context.steps.push(testScriptlet);
        }
    };

    self.endStep = function() {
        testScriptlet = null;
    };

    self.getScribe = function() {
        return  makeScribe(testScriptlet);
    };

    self.transcript = transcript;

    return self;

};

exports.makeReporter = makeReporter;