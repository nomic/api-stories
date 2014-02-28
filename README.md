# stories.js

JSON API testing without the fuss.

## Example

```js
suite("Lists", function() {

    before(function(driver) {
        // Good idea to create helpers for the really common
        // setup stuff.
        helpers.setupUsers(driver, ["mia", "ben"]);

        driver
            .as("admin")
            .POST("/list", {
                handle: "yogis",
                name: "Yogis"
            })
            .stash("yogis");
    });

    test("Admins can manipulate a list's members",

        step("Start a basic membership", function(driver) {
            driver
                .as("admin")
                .POST("/list/:yogis.id/membership/:mia.id")
                .expect(200, {
                    member: {id: ":mia.id"}
                });
        }),

        step("Add a founder", function(driver) {
            driver
                .POST("/list/:yogis.id/membership/:ben.id", {
                    membershipType: "founder"
                })
                .expect(200, {
                    member: {id: ":ben.id"},
                    membershipType: "founder"
                });
        }),

        step("End a membership", function(driver){
            driver
                .DELETE("/list/:yogis.id/membership/:mia.id")
                .expect(204)
                .DELETE("/list/:yogis.id/membership/:ben.id")
                .expect(204)
                .wait()
                .GET("/list/:yogis.id/membership")
                .expect(200, { $length: 0 });
        })
    );
    
    //more tests ....

});
```

## Another testing framework?  Why?

api-stories.js is only for testing JSON APIs.  That's it.  This focus has some benefits.  Your
tests are passed in a ```driver``` that is custom made to deal with scraping, checking
and creating JSON.  The driver also streamlines the asynchronous handling of API results,
and provides helpers particular to API testing such as polling for eventual consistancy
with ```until()```.  Lastly, stories can trace your API requests, dumping a JSON
document containing all API activity.  It is easy to render this dump and our team
uses it as our API documentation (though I have not made the trivial rendering app public).

Similar to other automated test harnesses, stories allows you to break your tests up using
the ```suite``` and ```test``` key words.  But stories adds two more key words:
```step``` and ```branch```.

Stories is inspired by how use cases are structured and is intended for higher level integration
tests. These tests tend to naturally be made up of several steps, where later steps are dependent
on the success of earlier steps.  This is different from unit tests which, ideally, are short
and test exactly one thing in isolation.  (Note: api-stories.js is inspired by use cases but I
promise there is *no* *attempt* to simulate the english language here!)

So with Stories you break your test into steps.  For example, as a first step a user might
send an invitation.  Then, in the next step, another user can accept the invite.  Finally,
in the last step, the original user can check that they got notified about their invite
being accepted.

Use cases can branch, and so can stories.js tests.  Anywhere you create a step you can
instead create branches, where, back to our example, one branch could accept the invite and the
other could decline.  If you use ```branch```, stories.js determines all paths through your
branches, and will run an isolated test for each path, running your ```before``` and ```after```
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
            .POST("/invites", {to: "harry"})
            .stash("invite")
            .expect(200, {to: "harry"});
        }),

        step("Receive invite", function(driver) {

            driver
            .introduce("recipient")
            .GET("/invites/to/:invite.to")
            .expect(200, {code: "$exists", to: ":invite.to"})
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
