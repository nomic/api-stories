# stories.js

JSON API testing without the fuss.

## How is stories.js different from other testing frameworks.

Similar to other automated test harnesses, stories allows you to break your tests up using
the ```suite``` and ```test``` key words.  But stories adds two more key words:
```step``` and ```branch```.

Stories.js is inspired by how use cases are structured (though there is no attempt to simulate the
english language here!) and is made for higher level integration tests, in particular tests
that hit a JSON API. These tests tend to naturally be made up of several steps, where the last steps
are quite dependent on the first steps.  This is different from unit tests which, ideally, are small
and test exactly one thing.

Rather than make you choose between short API tests requiring lots of one-off setup or fixture
data, or long tests that do a series of things and could fail anywhere, stories.js
lets you create a test that is broken into steps.  So, for example, you can create an
invite in one step, another user can accept the invite in the next step, and then you can confirm
that you got notified about the acceptance in the final step.

Finally, use cases can branch, and so can stories.js tests.  Anywhere you create a step you can
instead create branches, where, back to our example, one branch could accept the invite and the
other could declinde.  Stories.js determines all paths before running your test, and will
effectively run an isolated test for each path, running your ```before``` and ```after```
directives and starting from the beginning (creating the invite).

## Terminology

### Step

A story may be broken up into steps.  For example, (1) send an invite and then (2) accept the invite.

### Branch

There may be branching between steps as is common in real world scenarios.  For example, you might want
to test accepting an invite and also declining an invite.

### Path

The invite story just described has two paths:

* invite > accept
* invite > decline

Note there are three steps, and two paths.  A path is one of the possible trips through the steps of a
story.  When a story is executed, all paths will be tested.

## Running stories

```bash
$ ./stories --help
```

### An example invocation

```bash
$ stories tests/*
```

## A Simple Example

```js
// invites.js

suite("Invites", function() {

    test("Send", function(driver) {

        driver
        .introduce("sender")  //create a session (cookie jar) we'll refer to as "sender"

        .POST("/invites")
        .stash("invite")
        .expect(200, {to: "1234"});

    });

});
```

## A Story With Steps

```js
// invites.js
// Note that steps can contain more steps, and nest as deeply as you like

suite("Invites", function() {

    test("Send an invite and respond to it",

        step("Send invite", function(driver) {

            driver
            .introduce("sender")  //create a session (cookie jar) we'll refer to as "sender"
            .POST("/invites")
            .stash("invite")
            .expect(200, {to: "1234"});
        }),

        step("Receive invite", function(driver) {

            driver
            .introduce("recipient")
            .GET("/invites/to/1234")
            .expect(200, {code: "$exists", to: "1234"})
            .stash("invite");

        }),


        branch(
            step("accept", function(driver) {

                driver
                .as("recipient")
                // use a ":" to dereference a previously stashed results
                .POST("/invites/accept", {code: ":invite.code"})
                .expect(200);
            })
        ),

        branch(
            step("decline", function(driver) {
                // code for declining the invite goes here
            })
        ),

    ));

});

```


## Driver

Each story or step is passed a driver.

A driver makes it easy to call your api and run expectations on it.

Additionally, a driver manages two very useful pieces of state:

1. user sessions: http cookie collections tied to user aliases
2. the stash: responses you save to use in later requests



### Stash

Any request result can be stashed, e.g.:

```js
        .stash("invite");
```

You can stash only part of a result if you like:

```js
        .stash("inviteCode", function(body) { return body.code; });
```

Anything you've stashed can be retrieved by passing in a name preceded by a ":".  You can also
destash a nested attribute like this: ```":invite.code"```.

You can use these ":" names in urls as well, request bodies, and expectations.

The stash is also a nice way to ensure that an operation does not run until some result it needs is
available.  An operation just waits until the stashed result has been fulfilled.


### Expectations

* The default behavior is to check that the response has *at least* the specified values,
  i.e. the expectation does not need to include all of the responses values
* $unordered: Replace an [1,2,3] with {$unordered: [1, 2, 3]} if you do not care about the order of the result
* $length: Replace [1,2,3] with {$length: 3} if all you care about is length
* {key: "$not-exists"} is {key: "$exists"{: insure the specified field is not present or is present
* $int: require any integer
* $date: require any iso date
* $whatsNext?: let's add more $modifiers as we need them to make comparisons powerful!
* Check out [expector.js](https://github.com/nomic/api-driver/blob/master/lib/expector.js) to find all the special '$' keywords.

### Until

* .until(...) works exactly like .expect(...), only it will repeat the previous api call
  *until* the stated condition is met, or give up after 10 seconds (not configurable yet)

## Before

There are two important before methods.  These are analogous to "setup" in your typical testing
suite.

* beforeEach(fn) : The "global" before.  fn is called before any path is started
* before(fn) : Declared inside a story.  fn is called just after the global before, and just ahead
  of any path in the current story.

## Waiting on EventEmitter Events

The `driver.on(emitter, evt, [ fn ])` can be used to wait on a specific `EventEmitter` event and optionally invoke `fn` when it is emitted.
If `fn` returns a value, this value will be the value the promise returns. If `fn` throws an exception, the promise will fail.
