# stories.js

JSON API testing without the fuss.

## Example Test

```js
suite("Invites", function() {

    before(function(driver) {
        // Good idea to create helpers for the really common
        // setup stuff.
        helpers.setupUsers(driver, ["mia", "ben"]);
    });

    test("Send an invite and respond to it",

        step("Send invite", function(driver) {

            driver
            .as("mia")
            .POST("/invites", {to: ":ben.name"})
            .expect(200, {to: ":ben.name"})
            .stash("invite");
        }),

        step("Receive invite", function(driver) {

            driver
            .as("ben")
            .GET("/invites/to/:ben.id")
            .until(200, [{code: "$exists", from: ":mia.id"}])
            .GET("/invites/to/:ben.id?status=accepted")
            .expect(200, {$length: 0})

        }),

        branch(
            step("Accept invite", function(driver) {

                driver
                .as("ben")
                .POST("/invites/accept", {code: ":invite.code"})
                .expect(204)
                .GET("/invites/to/:ben.id?status=accepted")
                .expect(200, {$length: 1})
            })
        ),

        branch(
            step("Decline invite", function(driver) {

                driver
                .as("ben")
                .POST("/invites/decline", {code: ":invite.code"})
                .expect(204)
            })
        ),

    ));
    
    // more invite tests can be added to the suite here...

});

```

## Get Started

```bash
$ npm install -g api-stories
$ stories --help
$ cat > stories_setup.js
var stories = require("stories")
stories.before( function(driver) {
    driver
        .config({
            requestEndpoint: "http://localhost:3000",
        })
});
$ stories tests/* 
```

## Another testing framework?  Why?

api-stories.js is only for testing JSON APIs.  That's it.  This focus has some benefits.  All
tests are passed a ```driver``` that manages cookies for multiple users and makes stringing
together many API calls relatively easy.  The driver also makes dealing with lags or eventual
consistency pretty easy: you just replace ```expect(...)``` with ```until(...)``` and the driver will
poll instead of doing a single request.  And, stories can trace your API requests, dumping a JSON
document containing all API activity organized by test.  It is easy to render this
dump and our team uses it as our API documentation (the rendering app is pretty basic, but is not
yet part of this github repo).

Similar to other automated test harnesses, stories allows you to break your tests up using
the ```suite``` and ```test``` key words.  But stories adds two more directives:
```step``` and ```branch```.

Step and branch are inspired by how use cases are structured.  Like use cases, high level
integration tests tend to be made up of several steps, where later steps are dependent on
the success of earlier steps.  This is quite different from unit tests which, ideally, are
short and test exactly one thing in isolation.

So with stories you are writing higher level tests, and you can, optionally, break your tests
into steps (and branches, which are a bit more experimental).  For example, as a first step
a user might send an invitation.  Then, in the next step, another user can accept the invite. 
Finally, in the last step, the original user can check that they got notified about the invite
being accepted.

## Configuration example:
A config file named ```stories_setup.js``` should be place somewhere above the folder that
contains your test files.  api-stories.js starts in the folder of your test files, then traverses to root looking for it.  Here's an example from a real project:

```js
"use strict";

var stories = require("stories"),
    _ = require("lodash"),
    assert = require("assert");

_.mixin(require("underscore.string").exports());

// Make these global for convenience.  Not required.
global.suite = stories.suite;
global.test = stories.test;
global.step = stories.step;
global.branch = stories.branch;
global.before = stories.before;
global.after = stories.after;

require("http").globalAgent.maxSockets = 20;

// If no expectation or until clause is specified,
// expect that we at least get a 2xx code.
function defaultExpectation(result) {
    assert(
      [200, 201, 202, 203, 204].indexOf(result.statusCode) !== -1,
      "Expectd 2xx status code by default, but got: " + result.statusCode +
      "\nResponse Body:\n"+JSON.stringify(result.json, null, 4)
    );
    return true;
}

// Setup the default directory for data files.
// The driver's upload command will look here.
// drive.config.data = __dirname + "/../data";

// Run this before every path of every suite.
stories.before( function(driver) {
    driver
        .config({
            requestEndpoint: "http://localhost:3100/api",
            defaultExpectation: defaultExpectation
        })
        .introduce("admin")
        .GET("/test/reset_elastic_search")
        .GET("/test/reset_database")
        .GET("/test/reset_caches/")
        .wait()
        .POST("/auth/form", {"handle": "roboto", "password": "abc1234"})
        .stash("admin");
});
```

## Running stories

```bash
$ ./stories --help
```

### An example invocation

```bash
$ stories tests/*
```


## Driver

Each story or step is passed a driver.

A driver makes it easy to call your api and check expectations.

Additionally, a driver manages two very useful pieces of state:

1. user sessions: http cookie collections tied to user aliases
2. the stash: responses you save to use in later requests


### .introduce(name)

Introduce an actor.  Under the hood, creates a new cookie collection, assigns it to that name, and sets it as the current cookie colleciton for subsequent requests.

### .as(name)

Switch the current actor.  Under the hood, this just switches the current cookie collection.  Must intrdoduce an actor first.

### Http methods
```
   .GET(url, headers)
.DELETE(url, headers)
  .HEAD(url, headers)
   .PUT(url, body, headers)
 .PATCH(url, body, headers)
  .POST(url, body, headers)
```

### .stash()
Any result can be stashed, e.g.:

```js
.stash("invite");
```

You can stash only part of a result if you like:

```js
.stash("inviteCode", function(result) { return result.json.code; });
```

Anything you've stashed can be retrieved by passing in a name preceded by a ":".  You can also
destash a nested attribute like this: ```":invite.code"```.

You can use these ":" names in urls, request bodies, and expectations.

The stash is also a nice way to ensure that an operation does not run until some result it needs is
available.  An operation just waits until the stashed result has been fulfilled.

### .wait([millis])
By default, driver executes all of your requests in parallel.  Often a request will automatically block because it needs a stashed variable from a previous requests.  However, other times you just need to say wait() if there is no such var that it makes sense to block on.  Requests after a wait() won't fire untill all previous requests have returned.  You can also specify an *additional* number of millis to wait for.


### .expect([statusCode], [fn | jsonExpression]);
* If using a custom fn, it must return true to pass, and return falsey or throw an exception to fail.
* The default behavior for a json expression is to check that the response has *at least* the specified values,
  i.e. the expectation does not need to include all of the responses values
* `$unordered`: Replace an [1,2,3] with {$unordered: [1, 2, 3]} if you do not care about the order of the result
* `$length`: Replace [1,2,3] with {$length: 3} if all you care about is length
* `{key: "$not-exists"}` and `{key: "$exists"}`: insure the specified field is not present or is present
* `$int`: require any integer
* `$date`: require any iso date
* `$gt`, `$gte`, `$lt`, `$lte`
* Check out [expector.js](https://github.com/nomic/api-driver/blob/master/lib/expector.js) to find all the special '$' keywords.

### .until()

* .until(..., [millis]) works exactly like .expect(...), only it will repeat the previous api call
  *until* the stated condition is met, or give up after 10 seconds (not configurable yet) or the
  specified time.  It's not recommended to specify millis, except when initially setting up
  the test.  If you try to give up fast, you'll end up with intermittent test failures, which are
  the worst kind of failures.

### .never()

* .never(..., [millis]) ensures that some expectation "never" comes to be, or at least doesn't happen
for a while... By default it waits 10 seconds.  (This can make testing take painfully long.  Need to
come up with a way to unblock future tests while leaving a never check active in the background.)
