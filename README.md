# Stories

JSON API testing without the fuss.

## Example Test

```js
suite("Invites", function() {

  before(function(driver) {
    driver
      .as("admin")
      .POST("/user", {handle: "mia", password: "abc123"})
      .wait()
      .introduce("mia")
      .POST("/auth", {handle: "mia", password:"abc123"});
  });

  test("Send an invite and respond to it",

    step("Send invite", function(driver) {
      driver
        .as("mia")
        .POST("/invites", {email: "ben@tester.com"})
        .expect(200, {
          email: "ben@tester.com",
          code: /[a-f1-9]{32}/,
          status: "pending"})
        .stash("invite");
    }),

    step("Can't send another invite to same email", function(driver) {
      driver
        .as("mia")
        .POST("/invites", {to: ":invite.email"})
        .expect(400, {reason: "$exists"});
    }),

    branch(
      step("Accept invite", function(driver) {
        driver
          .introduce("ben")
          .POST("/invites/:invite.code/accept")
          .expect(200)
          .as("mia")
          .GET("/invites?status=accepted")
          .until(200, {$length: 1})
      })
    ),

    branch(
      step("Decline invite", function(driver) {
        driver
          .introduce("ben")
          .POST("/invites/decline", {code: ":invite.code"})
          .expect(200)
          .as("mia")
          .GET("/invites?status=accepted")
          .never(200, {$length: 1})
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

## Generate a trace to use as API documentation

```bash
$ stories tests/* -o ../docs/transcripts
```

This dumps a JSON trace of all activity, organized by the test and step descriptions.  Our team
uses some trivial templates to render it, but that's not comitted to this repo yet.

## Another testing framework?  Why?

Stories is only for testing JSON APIs.  That's it.  This focus has some benefits.

### Streamlined API handling
All tests are passed a ```driver``` that manages cookies for multiple users and makes stringing
together many API calls pretty easy.  The driver also helps you deal with lags or eventual
consistency: you just replace ```expect(...)``` with ```until(...)``` and the driver will
poll instead of doing a single request.

### Generated documentation
Stories can trace your API requests, dumping a JSON document containing all API activity organized by tests.  It is easy to render this dump and our team uses it as our API documentation.

### Long tests, organized
Similar to other automated test harnesses, stories allows you to break your tests up using
the ```suite``` and ```test``` key words.  But stories adds two more directives: ```step``` and ```branch```.

Step and branch are inspired by how use cases are structured.  Like use cases, high level
integration tests tend to be made up of several steps, where later steps are dependent on
the success of earlier steps.  This is quite different from unit tests, which, ideally, are
short and test exactly one thing in isolation.

So with stories you can, optionally, break your test into steps.  (Branches are a bit experimental.
When you use branches, stories identifies all the unique paths through the test and runs each path in
isolation, i.e., creates a fresh driver for each.)

## Configuration example:
A config file named ```stories_setup.js``` should be place somewhere above the folder that
contains your test files. stories.js starts in the folder of your test files, then traverses to root looking for it.  Here's an example from a real project:

```js
"use strict";

var stories = require("stories"),
  _ = require("lodash"),
  assert = require("assert");

// Make these global for convenience.  Not required.
global.test = stories.test;
global.step = stories.step;
global.branch = stories.branch;
global.before = stories.before;
global.after = stories.after;

require("http").globalAgent.maxSockets = 20;

// If no expectation is specified, default to expecting a 2xx code
function defaultExpectation(result) {
  assert(
    [200, 201, 202, 203, 204].indexOf(result.statusCode) !== -1,
    "Expectd 2xx status code by default, but got: " + result.statusCode +
    "\nResponse Body:\n"+JSON.stringify(result.json, null, 4)
  );
  return true;
}

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
$ stories tests/*
```

## Reference

### stories

```js
suite("description", function() {

  before(function(driver) {
    //...
  });

  after(function(driver) {
    //...
  });

  //simple test
  test("description", function(driver) {
    //...
  });

  //multi step test
  test("description",
    step( "description", function(driver) {
      //...
    }),
    step( "description", function(driver) {
      //...
    })
  );
});
```

### driver
[driver github repo](https://github.com/nomic/api-driver)

The driver makes it easy to call your api and check expectations.

Additionally, a driver manages two very useful pieces of state:

1. user sessions: http cookie collections tied to user aliases
2. the stash: responses you save to use in later requests

#### .introduce(name)

Introduce an actor.  Under the hood, creates a new cookie collection, assigns it to that name, and sets it as the current cookie colleciton for subsequent requests.

#### .as(name)

Switch the current actor.  Under the hood, this just switches the current cookie collection.  Must intrdoduce an actor first.

#### http methods
```
   .GET(url, headers)
.DELETE(url, headers)
  .HEAD(url, headers)
   .PUT(url, body, headers)
 .PATCH(url, body, headers)
  .POST(url, body, headers)
```

#### .stash()
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

#### .wait([millis])
By default, driver executes all of your requests in parallel.  A request will automatically block if it depends on a stashed value.  However, when you need to wait for some previous request to complete
but you are not depent upon a returned value, you can use wait().  Requests after a wait() won't fire untill all previous requests have returned.  You can also specify an *additional* number of millis to wait for, but this is generally a brittle approach to handling lags (see until() below).


#### .expect([statusCode], [fn | jsonExpression]);

##### fn(result)
If using a custom fn, it must return a truthy to pass, and return a falsey or throw an exception to fail.  The result obect has the following keys:

* json: http response body parsed as json
* text: http response body as a string
* headers: http response headers
* statusCode: http status code

##### jsonExpressions
* The default behavior for a json expression is to check that the response has *at least* the specified values, i.e. the expectation does not need to include all of the responses values
* `$unordered`: Replace an [1,2,3] with {$unordered: [1, 2, 3]} if you do not care about the order of the result
* `$length`: Replace [1,2,3] with {$length: 3} if all you care about is length
* `{key: "$not-exists"}` and `{key: "$exists"}`: insure the specified field is not present or is present
* `$int`: require any integer
* `$date`: require any iso date
* `$gt`, `$gte`, `$lt`, `$lte`
* Check out [expector.js](https://github.com/nomic/api-driver/blob/master/lib/expector.js) to find all the special '$' keywords.

#### .until([statusCode], [fn | jsonExpression], [millis])

Works exactly like .expect(...), only it will repeat the previous api call
*until* the stated condition is met, or give up after 10 seconds or the
specified time.  It's not recommended to specify millis, except when initially setting up
the test.

#### .never([statusCode], [fn | jsonExpression], [millis])

Ensure that an expectation "never" comes to be, or at least doesn't happen
for a while... By default it waits 10 seconds.  (This can make testing take painfully long...
Would be nice if never tests could run in the background and not block the next test, but this
won't work if you are clearing your server state between tests.)
