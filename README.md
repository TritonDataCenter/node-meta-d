Meta-D

We want to have a declarative way of describing metrics that meets the following goals:

This page will be fully fleshed out over time, the writeup of Meta-D is a work in progress.

Have a common base for describing metrics across kstats, DTrace, and future means of gathering data
Makes it easy to add new metrics and enhance what's currently there
Have third-parties able to use this syntax to add new metrics
Each metric is an object with the following fields:

module: A category for metrics
stat: The unique thing inside the module this metric tracks. The tuple (module, stat) will always be unique.
label: A human readable name to understand the metric
type: Describes what kind of data we are gathering
fields: Fields is an object that describe valid decompositions for a metric.
The fields object has one entry per decomposition. The key is used to interact with the API. The value is an object with two fields itself. The label is used to describe the decomposition. The type is one of the valid CA types. The type is very important. The type determines valid transformations and whether or not a decomposition results in a numeric or discrete decomposition.

As an example of the full metric object if we are tracing system call operations we might get something that looks like:

{
        module: 'syscall',
        stat: 'ops',
        type: 'ops',
        label: 'syscalls',
        fields: {
                hostname: {
                        label: 'hostname',
                        type: mod_ca.ca_type_string,
                },
                zonename: {
                        label: 'zone name',
                        type: mod_ca.ca_type_string,
                },
                optype: {
                        label: 'type',
                        type: mod_ca.ca_type_string,
                },
                execname: {
                        label: 'application name',
                        type: mod_ca.ca_type_string,
                },
                latency: {
                        label: 'latency',
                        type: mod_ca.ca_type_latency
                }
        }
}
Meta-D
Meta-D, as Bryan has coined it, is a declaratory way to describe a DTrace based metric in JSON. From this object, we can create everything we need for the specific instrumentation. We'll start off with an example and then go and describe all the fields and what is required:

1 /*
 2  * DTrace metric for system calls by operation.
 3  */
 4 var mod_ca = require('../../../../lib/ca/ca-common');
 5
 6 var desc = {
 7     module: 'syscall',
 8     stat: 'ops',
 9     label: 'syscalls',
10     type: 'ops',
11     fields: {
12         hostname: { label: 'hostname', type: mod_ca.ca_type_string },
13         zonename: { label: 'zone name', type: mod_ca.ca_type_string },
14         syscall: { label: 'system call', type: mod_ca.ca_type_string },
15         execname: { label: 'application name',
16             type: mod_ca.ca_type_string },
17         latency: { label: 'latency', type: mod_ca.ca_type_latency }
18     },
19     metad: {
20         probedesc: [
21             {
22                 probes: [ 'syscall:::entry' ],
23                 gather: {
24                         latency: {
25                                 gather: 'timestamp',
26                                 store: 'thread'
27                         }
28                 }
29             },
30             {
31                 probes: [ 'syscall:::return' ],
32                 aggregate: {
33                         default: 'count()',
34                         zonename: 'count()',
35                         syscall: 'count()',
36                         hostname: 'count()',
37                         execname: 'count()',
38                         latency: 'llquantize(%0, 10, 3, 11, 100)'
39                 },
40                 transforms: {
41                         hostname:
42                             '"' + mod_ca.caSysinfo().ca_hostname + '"',
43                         zonename: 'zonename',
44                         execname: 'execname',
45                         syscall: 'probefunc',
46                         latency: 'timestamp - %0'
47                 },
48                 verify: {
49                         latency: '%0'
50                 }
51             },
52             {
53                 probes: [ 'syscall:::return' ],
54                 clean: {
55                         latency: '%0'
56                 }
57             }
58         ]
59     }
60 };
Meta-D Object
Currently the metad object has one required field (probedesc) and one optional field (usdt):

probedesc: This is a description of the DTrace probes that we are going to work with
usdt: This tells us whether we are using USDT probes and enables the use of #prgama D option zone=%s
probedesc overview
The probe description is the heart of Meta-D. It is an array of objects. First we present an overview of the keys, then we will discuss what is required and what dependencies exist, and finally we will discuss the details of each key.

probes: This tells us with actual probes to instrument
gather: This tells us which fields we should gather during this probe, if they are necessary
alwaysgather: This is similar to the gather argument, except we gather this information regardless of whether it seems necessary based on the requested instrumentation
verify: This tells us how we should make sure that we have a value that we want to aggregate on
local: A series of clause-local variables that we should use for this probe
predicate: A D expression that describes any predicates to add to this clause
aggregate: This tells us to aggregate during this clause, this object describes the D necessary to aggregate
transforms: This object tells us how we should retrieve the values for specific fields.
clean: Tells us how to zero-out variables that we have gathered.
When writing out the D, we generate it in the order of the probedesc array. We don't always use every entry of the probedesc array. For example, if we are just generating the raw system calls count above, we don't need to generate the entry probe clause that gathers data or the return probe clause that cleans out the data, we only need the single clause with the aggregation that are used.

probes field
This field is an array of strings that correspond to the various probes that should be used for this clause. You can use any valid way to represent the probes as you would in D. The following are all valid examples:

[ 'node*:::http-server-request' ]
[ 'node*:::socket-read', 'node*:::socket-write' ]
[ 'sched:::on-cpu' ]
[ 'ip:::' ]
This field is required for each entry in the probedesc.

gather and alwaysgather
The gather and alwaysgather expressions direct us to gather a piece of information earlier on in one probe and save it for use, to aggregate on, in a later probe. The two expressions differ in that a gather is only generated if it is needed because of predicate or decomposition requests that field, but a probe with alwaysgather will gather that data regardless of what is requested. This is useful if there are predicates you need to always apply that rely on specific information.

Each of these values should be an object. The keys in the object should correspond to the fields that we need to get information for. Each of these fields is an object with two values which are either strings or arrays of strings of equal length. The string is essentially is a syntactic sugar for having an array of length, which is by far the most common case. When using an array, the index in the gather corresponds to the store. These required fields are:

gather: This is a D expression that describes how to get the value
store: This is a string that describes how to store the value
When storing values we must consider two different things:

A variable's scope – Whether it is thread-local or not
Are we using an associative array
If we are storing a variable in a thread-local variable, we must prefix with the string 'thread'. If we want to be storing it globally we must use the string 'global'. To specify an associative array you must specify how to index into the array in D. For example: 'arg0' would index into the array based on the value of argument 0. An associative array should follow the scope declaration. The following are examples of valid gather and store combinations:

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
When using Meta-D, you don't have to worry about the name that we are using to store this value. Rather, when writing transform, verify, and clean blocks, this can be referred to via the index one is interested in. Recall that the gather and store fields can be arrays and when we only have one entry we just use a string. In the above examples, the index for both is 0. Thus in one of the other statements I can use $0 and that will give the name of the value we are storing the given object in. If you had an array of three gathers and stores, you could refer to them via $0, $1, and $2.

verify
When we aggregate, we need to make sure that we have gathered the values before we use them in an aggregate. This is intended to protect against the case where we have hit a probe that we aggregate on before we have hit a probe that we gather the value at. For this, we check that every value gathered is not null. You are required to have a verify in any clause that you aggregate in for values that are gathered. The verify statement has one key per entry and tells us how to access the data. This includes describing how we index into associative arrays. The verify statement for the example gather statement above would look like:

verify: {
        latency: '$0',
        execname: '$0[arg0]'
}
Similar to the case where we could gather multiple variables per key, you must describe how to verify all of them. To do this, you should use an array, where each entry corresponds to another value.

It is important to note that you cannot refer to variables declared by a local statement in the verify code.

local
This declaration allows us to create a clause local variable that is usable for the duration of the given entry in the probedesc statement. These local declarations can be used in all other fields aside from the verify clause.

The local declaration is an array of objects. It is guaranteed that the first object will be assigned before subsequent ones, allowing for later entries in the local declaration to refer to previous ones. Each entry in the array is an object with one key and a string value. The key is used to generate the name of the clause local variable. It must be unique and thus different from any of the fields.

Each value will be assigned to a variable with the schema of this->'key', where key corresponds to the single key in the struct.

For example:

local: [
       {  fd: '((xlate <node_connection_t *>((node_dtrace_connection_t *)arg0))->fd)' }
]
One could now reference the file descriptor via 'this->fd'.

transformations
The transformations argument says for a given field, how do we access that data for this probe. We use this information throughout when resolving predicates that are passed in, in aggregating actions, and determining indexes for aggregation. This is an object where each key is the name of a field and the value is the string that describes how to get access to the value and perform any transformations on it before DTrace processes it. If the value was previously gathered, as discussed in the gather section, these values can be referenced via $0, $1, etc. Continuing the example used earlier in the verify section we would have a transformations that looked like:

transformations: {
        latency: 'timestamp - $0',
        execname: '$0[arg0]',
        zonename: 'zonename'
}
aggregate
The aggregate object has two purposes. First, it tells us that we need to have an aggregation statement here. Second, it tells us what aggregation method to use. In addition to the fields which you are aggregating, you are required to have a default entry which describes what do do when no decompositions have been selected. Often times it is valuable to refer to the result of a transformation for the given key such as aggregating latency. To do this, you may use $0 to refer to the result of the transformation. Discrete decompositions are automatically applied into the index of the aggregation based on the requested instrumentation. Continuing our example from before would result in:

aggregate: {
        default: 'count()',
        latency: 'llquantize($0, 10, 3, 11, 100)',
        zonename: 'count()',
        execname: 'count()'
}
At this time it is only possible to have one aggregation array. It may be used in multiple probes.

clean
When a variable has been stored it is important that we also clean out the value that we have gathered. We clear out all values by explicitly setting them to zero. A clean statement tells us how to access the variable, which allows us to index into an associative array in many cases. Because a gather statement can store multiple values, if more than one is used an array of strings is necessary, where each correspond to the same array entry in the gather object. Most commonly there is only one value so a single string may be used. A clean statement for our example would look like:

clean: {
        latency: '$0',
        execnme: '$0[arg0]'
}
probedesc requirements
Each entry in the probedesec array must have the following:

probes field
transforms if aggregate is specified
verify if aggregate is specified and we have some gather statements
Across all of the probedesc entries we must have the following:

At least one aggregate
A clean if a gather has occurred
More complicated examples
Now, the syscall example we did above is fairly straight forward. Here are a few more examples that make use of the other fields:

1 /*
 2  * DTrace metric for node.js http operations
 3  */
 4 var mod_ca = require('../../../../lib/ca/ca-common');
 5
 6 var desc = {
 7     module: 'node',
 8     stat: 'httpd_ops',
 9     label: 'HTTP server operations',
10     type: 'ops',
11     fields: {
12         method: { label: 'method', type: mod_ca.ca_type_string },
13         url: { label: 'URL', type: mod_ca.ca_type_string },
14         raddr: { label: 'remote IP address',
15             type: mod_ca.ca_type_ipaddr },
16         rport: { label: 'remote TCP port',
17             type: mod_ca.ca_type_string },
18         latency: { label: 'latency', type: mod_ca.ca_type_latency }
19     },
20     metad: {
21         probedesc: [
22             {
23                 probes: [ 'node*:::http-server-request' ],
24                 gather: {
25                         url: {
26                                 gather: '((xlate <node_http_request_t *>' +
27                                     '((node_dtrace_http_request_t *)arg0))->' +
28                                     'url)',
29                                 store: 'global[pid,this->fd]'
30                         }, method: {
31                                 gather: '((xlate <node_http_request_t *>' +
32                                     '((node_dtrace_http_request_t *)arg0))->' +
33                                     'method)',
34                                 store: 'global[pid,this->fd]'
35                         }, latency: {
36                                 gather: 'timestamp',
37                                 store: 'global[pid,this->fd]'
38                         }
39                 },
40                 local: [ {
41                         fd: '(xlate <node_connection_t *>' +
42                             '((node_dtrace_connection_t *)arg1))->fd'
43                 } ]
44             },
45             {
46                 probes: [ 'node*:::http-server-response' ],
47                 local: [ {
48                         fd: '((xlate <node_connection_t *>' +
49                             '((node_dtrace_connection_t *)arg0))->fd)'
50                 } ],
51                 aggregate: {
52                         url: 'count()',
53                         method: 'count()',
54                         raddr: 'count()',
55                         rport: 'count()',
56                         latency: 'llquantize(%0, 10, 3, 11, 100)',
57                         default: 'count()'
58                 }, 
59                 transforms: {
60                         url: '%0[pid,this->fd]',
61                         method: '%0[pid,this->fd]',
62                         raddr: '((xlate <node_connection_t *>' +
63                             '((node_dtrace_connection_t *)arg0))->' +
64                             'remoteAddress)',
65                         rport: 'lltostr(((xlate <node_connection_t *>' +
66                             '((node_dtrace_connection_t *)arg0))->remotePort))',
67                         latency: 'timestamp - %0[pid,this->fd]'
68                 },
69                 verify: {
70                         url: '%0[pid,this->fd]',
71                         latency: '%0[pid,this->fd]',
72                         method: '%0[pid,this->fd]'
73                 }
74             },
75             {
76                 probes: [ 'node*:::http-server-response' ],
77                 local: [ {
78                         fd: '((xlate <node_connection_t *>' +
79                             '((node_dtrace_connection_t *)arg0))->fd)'
80                 } ],
81                 clean: {
82                         url: '%0[pid,this->fd]',
83                         method: '%0[pid,this->fd]',
84                         latency: '%0[pid,this->fd]'
85                 }
86             }
87         ],
88         usdt: true
89     }
90 };
Internal Fields
To help facilitate the writing of Meta-D, you may declare a field to be internal only. If you do, you would add the following to the fields object:

vnode: {
       internal: true
}
Anything marked internal will not be propagated out of the dtrace module of the instrumenter and never be communicated over AMQP. However, it can now be gathered and used in transformations, though not aggregated. This is useful for storing pieces of information that you have at an entry probe but no in a return probe. For example, when working with logical filesystem operations, we have an internal field for the vnode, which we later dereference to get the name of the filesystem.
