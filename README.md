# Meta-D

Meta-D is a declarative way to describe a DTrace based metric. From a Meta-D description of a metric, we can generate several D scripts depending on what *fields* the user wants to filter on and break out the results by.  

## Quick start

There are a few examples in the `examples/` directory.  Each example describes a
family of DTrace scripts.  The simplest example is `syscall-ops.js`, described
below.  You can use the **meta-d** command to generate specific D scripts that
filter out or break out the number of system calls.

The simplest case would be counting system calls:

```
$ meta-d examples/syscall-ops.js 
syscall:::return
{
	@ = count();
}

```

You can also break out system calls by "psargs", which is the program name,
including arguments:

```
$ meta-d -s psargs examples/syscall-ops.js 
syscall:::return
{
	@[(curpsinfo->pr_psargs)] = count();
}

```

You can also filter for a specific program name using
[krill](https://github.com/joyent/node-krill) syntax:

```
$ meta-d -p '{ "eq": [ "execname", "postgres" ] }' examples/syscall-ops.js
syscall:::return
/(((execname) == "postgres"))/{
	@ = count();
}
```

If you want to break out the results by a number (e.g., latency), it's useful
to bucketize values:

```
$ meta-d -n latency examples/syscall-ops.js
syscall:::entry
{
	self->latency0 = timestamp;
}

syscall:::return
/((((((self->latency0) != NULL)))))/{
	@ = llquantize((timestamp - self->latency0), 10, 3, 11, 100);
}

syscall:::return
{
	(self->latency0) = 0;
}

```


## Meta-D reference

We'll start off with an example and then go and describe all the fields and what is required:

```javascript
/*
 * DTrace metric for system calls by operation.
 */
{
    fields: [ 'hostname', 'zonename', 'syscall', 'execname', 'latency' ],
    metad: {
        probedesc: [
            {
                probes: [ 'syscall:::entry' ],
                gather: {
                        latency: {
                                gather: 'timestamp',
                                store: 'thread'
                        }
                }
            },
            {
                probes: [ 'syscall:::return' ],
                aggregate: {
                        default: 'count()',
                        zonename: 'count()',
                        syscall: 'count()',
                        hostname: 'count()',
                        execname: 'count()',
                        latency: 'llquantize(%0, 10, 3, 11, 100)'
                },
                transforms: {
                        hostname: '$hostname',
                        zonename: 'zonename',
                        execname: 'execname',
                        syscall: 'probefunc',
                        latency: 'timestamp - %0'
                },
                verify: {
                        latency: '%0'
                }
            },
            {
                probes: [ 'syscall:::return' ],
                clean: {
                        latency: '%0'
                }
            }
        ]
    }
}
```

There are three top-level properties:

* `fields`: a list of fields the user can filter by (using a *predicate*) or decompose by.  In this case, the user can filter or break out the results by hostname, zonename, syscall name, execname, or latency.  These names are only useful to the Meta-D user.  Meta-D provides ways of translating these names into appropriate D expressions.
* `fields_internal`: see "Internal Fields" below
* `metad`: describes the parts of the D script

The `metad` object has a couple of properties:

* `probedesc`: This is a description of the DTrace probes that we are going to work with
* `usepragmazone`: This tells us whether we are using USDT probes and enables the use of `#pragma D option zone=%s`


### `probedesc` overview

The probe description is the heart of Meta-D. It is an array of objects. First we present an overview of the keys, then we will discuss what is required and what dependencies exist, and finally we will discuss the details of each key.

* `probes`: which actual probes to instrument
* `gather`: which fields' values should be gathered during this probe, if they are necessary
* `alwaysgather`: fields' whose values should always be gathered, even if the user is not filtering or decomposing by this field
* `verify`: for each field, a D expression describing how to know that this field has already been gathered
* `local`: a series of clause-local variables that should be used for this probe
* `predicate`: a D expression that describes any predicates to add to this clause
* `aggregate`: indicates which fields should be aggregated during this clause, including the D expressions used to aggregate their values
* `transforms`: for each field, a D expression representing the field's value
* `clean`: for each field, a D expression to be zero'd out

The generated D script is written in the order of the `probedesc` array, though not every entry of the `probedesc` array is always used.  For example, if you generate the script for raw system calls count using the above Meta-D, we don't need to generate the "entry" clause that gathers data or the "return" clause that cleans out the data; we only need the single clause with the aggregation that are used.

#### `probes` field

This field is an array of strings that correspond to the various probes that should be used for this clause. You can use any valid way to represent the probes as you would in D. The following are all valid examples:

```javascript
[ 'node*:::http-server-request' ]
[ 'node*:::socket-read', 'node*:::socket-write' ]
[ 'sched:::on-cpu' ]
[ 'ip:::' ]
```

This field is required for each entry in the `probedesc`.

#### `gather` and `alwaysgather`

The `gather` and `alwaysgather` expressions direct us to gather a piece of information earlier on in one probe and save it for use, to aggregate on, in a later probe. The two expressions differ in that a `gather` is only generated if it is needed because of predicate or decomposition requests that field, but a probe with `alwaysgather` will gather that data regardless of what is requested.  This is useful if there are predicates you need to always apply that rely on specific information.

Each of these values should be an object. The keys in the object should correspond to the fields that we need to get information for. Each of these fields is an object with two values which are either strings or arrays of strings of equal length. The string is essentially is a syntactic sugar for having an array of length, which is by far the most common case. When using an array, the index in the gather corresponds to the store. These required fields are:

* `gather`: This is a D expression that describes how to get the value
* `store`: This is a string that describes how to store the value

When storing values we must consider two different things:

* A variable's scope – Whether it is thread-local or not
* Are we using an associative array

If we are storing a variable in a thread-local variable, we must prefix with the string 'thread'. If we want to be storing it globally we must use the string 'global'. To specify an associative array you must specify how to index into the array in D. For example: 'arg0' would index into the array based on the value of argument 0. An associative array should follow the scope declaration. The following are examples of valid gather and store combinations:

```javascript
gather: {
        latency: {
                gather: 'timestamp',
                store: 'thread'
        },
        execname: {
                gather: 'execname',
                store: 'global[arg0]'
        }
}
```

When using Meta-D, you don't have to worry about the name that we are using to store this value. Rather, when writing transform, verify, and clean blocks, this can be referred to via the index one is interested in. Recall that the gather and store fields can be arrays and when we only have one entry we just use a string. In the above examples, the index for both is 0. Thus in one of the other statements I can use $0 and that will give the name of the value we are storing the given object in. If you had an array of three gathers and stores, you could refer to them via $0, $1, and $2.

#### `verify`

When we aggregate, we need to make sure that we have gathered the values before we use them in an aggregate. This is intended to protect against the case where we have hit a probe that we aggregate on before we have hit a probe that we gather the value at. For this, we check that every value gathered is not null. You are required to have a `verify` in any clause that you aggregate in for values that are gathered. The `verify` statement has one key per entry and tells us how to access the data. This includes describing how we index into associative arrays. The verify statement for the example gather statement above would look like:

```javascript
verify: {
        latency: '$0',
        execname: '$0[arg0]'
}
```

Similar to the case where we could gather multiple variables per key, you must describe how to verify all of them. To do this, you should use an array, where each entry corresponds to another value.

It is important to note that you cannot refer to variables declared by a local statement in the verify code.

#### `local`

This declaration allows us to create a clause local variable that is usable for the duration of the given entry in the probedesc statement. These local declarations can be used in all other fields aside from the `verify` clause.

The `local` declaration is an array of objects. It is guaranteed that the first object will be assigned before subsequent ones, allowing for later entries in the `local` declaration to refer to previous ones. Each entry in the array is an object with one key and a string value. The key is used to generate the name of the clause local variable. It must be unique and thus different from any of the fields.

Each value will be assigned to a variable with the schema of `this->'key'`, where key corresponds to the single key in the struct.

For example:

```javascript
local: [
       {  fd: '((xlate <node_connection_t *>((node_dtrace_connection_t *)arg0))->fd)' }
]
```

One could now reference the file descriptor via `this->fd`.

#### `transformations`

The `transformations` argument says for a given field, how do we access that data for this probe. We use this information throughout when resolving predicates that are passed in, in aggregating actions, and determining indexes for aggregation. This is an object where each key is the name of a field and the value is the string that describes how to get access to the value and perform any transformations on it before DTrace processes it. If the value was previously gathered, as discussed in the gather section, these values can be referenced via $0, $1, etc. Continuing the example used earlier in the verify section we would have a transformations that looked like:

```javascript
transformations: {
        latency: 'timestamp - $0',
        execname: '$0[arg0]',
        zonename: 'zonename'
}
```

#### `aggregate`

The `aggregate` object has two purposes. First, it tells us that we need to have an aggregation statement here. Second, it tells us what aggregation method to use. In addition to the fields which you are aggregating, you are required to have a default entry which describes what do do when no decompositions have been selected. Often times it is valuable to refer to the result of a transformation for the given key such as aggregating latency. To do this, you may use $0 to refer to the result of the transformation. Discrete decompositions are automatically applied into the index of the aggregation based on the requested instrumentation. Continuing our example from before would result in:

```javascript
aggregate: {
        default: 'count()',
        latency: 'llquantize($0, 10, 3, 11, 100)',
        zonename: 'count()',
        execname: 'count()'
}
```

At this time it is only possible to have one aggregation array. It may be used in multiple probes.

#### ```clean```

When a variable has been stored it is important that we also clean out the value that we have gathered. We clear out all values by explicitly setting them to zero. A `clean` statement tells us how to access the variable, which allows us to index into an associative array in many cases. Because a gather statement can store multiple values, if more than one is used an array of strings is necessary, where each correspond to the same array entry in the gather object. Most commonly there is only one value so a single string may be used. A `clean` statement for our example would look like:

```javascript
clean: {
        latency: '$0',
        execnme: '$0[arg0]'
}
```

#### `probedesc` requirements

Each entry in the probedesec array must have the following:

* `probes` field
* `transforms`, if `aggregate` is specified
* `verify`, if `aggregate` is specified and we have some `gather` statements

Across all of the `probedesc` entries we must have the following:

* At least one `aggregate`
* A `clean` if a `gather` has occurred

### More complicated examples

Now, the syscall example we did above is fairly straight forward. Here are a few more examples that make use of the other fields:

```javascript
/*
 * DTrace metric for node.js http operations
 */
{
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
        'pexecname', 'ppsargs', 'http_method', 'http_url', 'raddr', 'rport',
        'http_path', 'http_origin', 'latency' ],
    metad: {
        locals: [
            { fd: 'int' }
        ],
        probedesc: [
            {
                probes: [ 'node*:::http-server-request' ],
                gather: {
                        http_url: {
                                gather: '((xlate <node_http_request_t *>' +
                                    '((node_dtrace_http_request_t *)arg0))->' +
                                    'url)',
                                store: 'global[pid,this->fd]'
                        }, http_method: {
                                gather: '((xlate <node_http_request_t *>' +
                                    '((node_dtrace_http_request_t *)arg0))->' +
                                    'method)',
                                store: 'global[pid,this->fd]'
                        }, latency: {
                                gather: 'timestamp',
                                store: 'global[pid,this->fd]'
                        }, http_path: {
                                gather: 'strtok((xlate ' +
                                    '<node_http_request_t *> (' +
                                    '(node_dtrace_http_request_t *)' +
                                    'arg0))->url, "?")',
                                store: 'global[pid,this->fd]'
                        }, http_origin: {
                                gather: '((xlate <node_http_request_t *>' +
                                    '((node_dtrace_http_request_t *)arg0))->' +
                                    'forwardedFor)',
                                store: 'global[pid,this->fd]'
                        }
                },
                local: [ {
                        fd: '(xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg1))->fd'
                } ]
            },
            {
                probes: [ 'node*:::http-server-response' ],
                local: [ {
                        fd: '((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->fd)'
                } ],
                aggregate: {
                        http_url: 'count()',
                        http_method: 'count()',
                        raddr: 'count()',
                        rport: 'count()',
                        latency: 'llquantize($0, 10, 3, 11, 100)',
                        hostname: 'count()',
                        default: 'count()',
                        zonename: 'count()',
                        ppid: 'count()',
                        execname: 'count()',
                        http_origin: 'count()',
                        psargs: 'count()',
                        pid: 'count()',
                        http_path: 'count()',
                        ppsargs: 'count()',
                        pexecname: 'count()'
                },
                transforms: {
                        http_url: '$0[pid,this->fd]',
                        http_method: '$0[pid,this->fd]',
                        hostname: '$hostname',
                        raddr: '((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->' +
                            'remoteAddress)',
                        rport: 'lltostr(((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->remotePort))',
                        latency: 'timestamp - $0[pid,this->fd]',
                        zonename: 'zonename',
                        pid: 'lltostr(pid)',
                        ppid: 'lltostr(ppid)',
                        execname: 'execname',
                        psargs: 'curpsinfo->pr_psargs',
                        http_path: '$0[pid,this->fd]',
                        ppsargs:
                            'curthread->t_procp->p_parent->p_user.u_psargs',
                        pexecname: 'curthread->t_procp->p_parent->' +
                            'p_user.u_comm',
                        http_origin: 'strlen($0[pid,this->fd]) == 0 ? ' +
                            '((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->' +
                            'remoteAddress) : strtok($0[pid,this->fd], ",")'
                },
                verify: {
                        http_url: '$0[pid,((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->fd)]',
                        latency: '$0[pid,((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->fd)]',
                        http_method: '$0[pid,((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->fd)]',
                        /*
                         * The origin that we gather can actually be the empty
                         * string, but we don't want to skip this probe.
                         */
                        http_origin: '1',
                        http_path: '$0[pid,((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->fd)]'
                }
            },
            {
                probes: [ 'node*:::http-server-response' ],
                local: [ {
                        fd: '((xlate <node_connection_t *>' +
                            '((node_dtrace_connection_t *)arg0))->fd)'
                } ],
                clean: {
                        http_url: '$0[pid,this->fd]',
                        http_method: '$0[pid,this->fd]',
                        latency: '$0[pid,this->fd]',
                        http_origin: '$0[pid,this->fd]',
                        http_path: '$0[pid,this->fd]'
                }
            }
        ],
        usepragmazone: true
    }
}
```

### Internal Fields

To help facilitate the writing of Meta-D, you may declare a field to be internal only. To declare an internal field called `vnode`, you would add the following `fields_internal` object:

```javascript
'fields_internal': [ 'vnode' ]
```

Anything marked `internal` will not be emitted from the D script. However, it can now be gathered and used in transformations, though not aggregated. This is useful for storing pieces of information that you have at an entry probe but no in a return probe. For example, when working with logical filesystem operations, we have an internal field for the vnode, which we later dereference to get the name of the filesystem.
