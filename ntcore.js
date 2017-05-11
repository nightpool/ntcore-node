const ffi = require('ffi');
const ref = require('ref');
const Struct = require('ref-struct');
const Enum = require('enum');
const Union = require('ref-union');
const assert = require("assert");


// Native types
const nulltype = ref.types.null;
const int_t = ref.types.int;
const uint_t = ref.types.uint;
const size_t = ref.types.byte;
const double_t = ref.types.double;
const unsigned_long_long = ref.types.ulonglong;
const cstr = ref.types.CString;

// Native type pointers
const nullptr = ref.NULL_POINTER;
const int_ptr = ref.refType(int_t);
const size_ptr = ref.refType(size_t);
const double_ptr = ref.refType(double_t);
const unsigned_long_long_ptr = ref.refType(unsigned_long_long);
const cstr_ptr = ref.refType(cstr);

const u_nt_value_data = Union({
    v_boolean: int_t,
    v_double: double_t,
    v_string: cstr
});

const NT_Type = new Enum({
    'NT_UNASSIGNED': 0x00,
    'NT_BOOLEAN': 0x01,
    'NT_DOUBLE': 0x02,
    'NT_STRING': 0x04,
    'NT_RAW': 0x08,
    'NT_BOOLEAN_ARRAY': 0x10,
    'NT_DOUBLE_ARRAY': 0x20,
    'NT_STRING_ARRAY': 0x40,
    'NT_RPC': 0x80
});

NT_Type.from = function (i) {
    switch (i) {
        case 0x00:
            return NT_Type.NT_UNASSIGNED;
        case 0x01:
            return NT_Type.NT_BOOLEAN;
        case 0x02:
            return NT_Type.NT_DOUBLE;
        case 0x04:
            return NT_Type.NT_STRING;
        case 0x08:
            return NT_Type.NT_RAW;
        case 0x10:
            return NT_Type.NT_BOOLEAN_ARRAY;
        case 0x20:
            return NT_Type.NT_DOUBLE_ARRAY;
        case 0x40:
            return NT_Type.NT_STRING_ARRAY;
        case 0x80:
            return NT_Type.NT_RPC;
        default:
            console.log('Unknown type: ' + i);
            return NT_Type.NT_UNASSIGNED;
    }
};

const NT_NotifyKind = new Enum({
    // No notification
    'NT_NOTIFY_NONE': 0x00,
    // Initial listener addition
    'NT_NOTIFY_IMMEDIATE': 0x01,
    // Local change
    'NT_NOTIFY_LOCAL': 0x02,
    // Newly created entry
    'NT_NOTIFY_NEW': 0x04,
    // Entry was deleted
    'NT_NOTIFY_DELETE': 0x08,
    // Value changed
    'NT_NOTIFY_UPDATE': 0x10,
    // Flags changed
    'NT_NOTIFY_FLAGS': 0x20
});

exports.NT_NotifyKind = NT_NotifyKind;

const NT_Value = Struct({
    type: size_t,
    last_change: unsigned_long_long,
    data: u_nt_value_data
});

const NT_Value_ptr = ref.refType(NT_Value);

const NT_String = Struct({
    ptr: cstr,
    length: size_t
});

const NT_ConnectionInfo = Struct({
    remote_id: NT_String,
    remote_ip: NT_String,
    remote_port: uint_t,
    last_update: unsigned_long_long,
    protocol_version: uint_t
});

const NT_ConnectionInfo_ptr = ref.refType(NT_ConnectionInfo);

/**
 * Makes a ntcore key start with a forward slash '/'. Does nothing to keys that already start with '/'.
 * @param key the key to fix
 * @returns {*}
 */
function fix_key(key) {
    assert.equal(typeof key, 'string', `fix_key only works on strings (was given ${typeof key})`);
    if (key.startsWith('/')) {
        return key;
    } else {
        return '/' + key;
    }
}

/**
 * Bindings to the native ntcore library.
 * These are direct library calls and are dangerous to use;
 * the convenience functions defined in this module offer safe access to these functions.
 */
const lib = ffi.Library('./ntcore/Linux/amd64/libntcore', {
    // void NT_StartClient(const char* server_name, unsigned int port);
    'NT_StartClient': ['void', [cstr, int_t]],
    // void NT_SetUpdateRate(double interval);
    'NT_SetUpdateRate': ['void', [double_t]],
    'NT_AddConnectionListener': [uint_t, ['void *', 'void*', int_t]],
    'NT_RemoveConnectionListener': ['void', [uint_t]],
    'NT_AddEntryListener': [uint_t, [cstr, size_t, 'void *', 'pointer', uint_t]],
    'NT_RemoveEntryListener': ['void', [uint_t]],
    'NT_Flush': ['void', []],
    'NT_GetEntryBoolean': [int_t, [cstr, size_t, unsigned_long_long_ptr, int_ptr]],
    'NT_GetEntryDouble': [int_t, [cstr, size_t, unsigned_long_long_ptr, double_ptr]],
    'NT_GetEntryString': [cstr, [cstr, size_t, unsigned_long_long_ptr, size_ptr]],
    'NT_SetEntryBoolean': [int_t, [cstr, size_t, int_t, int_t]],
    'NT_SetEntryDouble': [int_t, [cstr, size_t, double_t, int_t]],
    'NT_SetEntryString': [int_t, [cstr, size_t, cstr, int_t, int_t]]
});

exports.lib = lib;

/**
 * Immediately pushes all values to the network.
 */
exports.flush = function () {
    lib.NT_Flush();
};

// Keep track of listeners to prevent them from getting GC'd
// Removing a listener with removeEntryListener will remove it
// from this array and allow it to be GC'd
const listeners = [];

/**
 * Creates a network table entry listener that invokes the given function.
 * @param jsFunction the listener function. This takes three parameters: The key, the value, and the flags for that key.
 * @returns {*} an FFI callback pointer
 */
createEntryListener = function (jsFunction) {
    let cb = ffi.Callback('void', [uint_t, 'pointer', cstr, size_t, NT_Value_ptr, uint_t],
        (id, data, key, key_length, value, flags) => {
            value = value.deref();
            var realValue;
            switch (value.type) {
                case NT_Type.NT_UNASSIGNED.value:
                    console.log('UNASSIGNED');
                    realValue = null;
                    break;
                case NT_Type.NT_BOOLEAN.value:
                    realValue = value.data.v_boolean === 1;
                    break;
                case NT_Type.NT_DOUBLE.value:
                    realValue = value.data.v_double;
                    break;
                case NT_Type.NT_STRING.value:
                    realValue = value.data.v_string;
                    break;
                default:
                    console.log(`Unknown type ${NT_Type.from(value.type)}`);
                    realValue = null;
                    break;
            }

            jsFunction(key, realValue, flags);
        });
    // Reference the callback to prevent GC
    listeners.push(cb);
    return cb;
};

createConnectionListener = function (jsFunction) {
    let cb = ffi.Callback('void', [uint_t, 'void *', int_t, NT_ConnectionInfo_ptr],
        (uid, data, isConnected, connectionInfo) => {
            jsFunction(uid, isConnected === 1, connectionInfo.deref());
        }
    );
    listeners.push(cb);
    return cb;
};

exports.createEntryListener = createEntryListener;

/**
 * Adds an entry listener to a key in network tables.
 * @param prefix the key to listen to
 * @param listener the listener function to notify when a change occurs
 * @param flags the flags that specify when the listener should be called
 */
exports.addEntryListener = function (prefix, listener, flags) {
    prefix = fix_key(prefix);
    let valuePtr = ref.alloc(NT_Value);
    lib.NT_AddEntryListener(prefix, prefix.length, valuePtr, createEntryListener(listener), flags);
};

exports.addConnectionListener = function (listener, immediateNotify = false) {
    let data = ref.alloc(NT_Value);
    lib.NT_AddConnectionListener(data, createConnectionListener(listener), immediateNotify ? 1 : 0);
};

/**
 * Removes an entry listener created with createEntryListener.
 * @param listener the listener to remove
 */
exports.removeEntryListener = function (listener) {
    if (listeners.indexOf(listener) >= 0) {
        lib.NT_RemoveEntryListener(listener);
        listeners.splice(listeners.indexOf(listener), 1);
    }
};

/**
 * Starts a NetworkTables client connected to the given host running a NetworkTables server on the given port.
 * For example, ntcore.connectToServer('localhost', 1735) will try to connect to a server running on port 1735 on
 * the local machine.
 *
 * @param host the ntcore server
 * @param port the port the server is running on. Defaults to 1735.
 */
exports.connectToServer = function (host, port = 1735) {
    lib.NT_StartClient(host, port);
};

/**
 * Sets the rate at which ntcore updates, in seconds. Defaults to 0.1 seconds (100ms). The lower bound
 * is 0.01 (10ms).
 * @param rate the rate at which ntcore should update
 */
exports.setUpdateRate = function (rate = 0.10) {
    lib.NT_SetUpdateRate(rate);
};

/**
 * Gets a boolean value associated with the given table key. Returns defaultValue if there is no boolean
 * value associated with the key.
 * @param key the key to get the boolean value for
 * @param defaultValue the value to return if no boolean value is associated with the key
 * @returns {boolean}
 */
exports.getBoolean = function (key, defaultValue = false) {
    key = fix_key(key);
    let last_change = ref.alloc(unsigned_long_long);
    let value = ref.alloc(int_t);
    let success = lib.NT_GetEntryBoolean(key, key.length, last_change, value);
    if (success) {
        return value.deref() === 1;
    } else {
        return defaultValue;
    }
};


/**
 * Gets a number value associated with the given table key. Returns defaultValue if there is no number
 * value associated with the key.
 * @param key the key to get the number value for
 * @param defaultValue the value to return if no number value is associated with the key
 * @returns {number}
 */
exports.getNumber = function (key, defaultValue = 0.0) {
    key = fix_key(key);
    let last_change = ref.alloc(unsigned_long_long);
    let value = ref.alloc(double_t);
    let success = lib.NT_GetEntryDouble(key, key.length, last_change, value);
    if (success) {
        return value.deref();
    } else {
        return defaultValue;
    }
};

exports.getString = function (key, defaultValue = '') {
    key = fix_key(key);
    let last_change = ref.alloc(unsigned_long_long);
    let size = ref.alloc(size_t);
    let value = lib.NT_GetEntryString(key, key.length, last_change, size);
    if (value === null || !(value instanceof String) || value.length !== size.deref()) {
        return defaultValue;
    } else {
        return value
    }
};

/**
 * Sets the given key to the given boolean value.
 * @param key the value key
 * @param value the value to set
 * @param force to force an overwrite of an existing non-boolean value
 */
exports.putBoolean = function (key, value, force = false) {
    key = fix_key(key);
    return lib.NT_SetEntryBoolean(key, key.length, value, force);
};

/**
 * Sets the given key to the given number value.
 * @param key the value key
 * @param value the value to set
 * @param force to force an overwrite of an existing non-numeric value
 */
exports.putNumber = function (key, value, force = false) {
    key = fix_key(key);
    return lib.NT_SetEntryDouble(key, key.length, value, force);
};

/**
 * Sets the given key to the given string.
 * @param key the value key
 * @param value the value to set
 * @param force to force an overwrite of an existing non-string value
 */
exports.putString = function (key, value, force = false) {
    key = fix_key(key);
    return lib.NT_SetEntryString(key, key.length, value, value.length, force);
};

exports.NT_Value = NT_Value;
exports.NT_Value_ptr = NT_Value_ptr;
exports.NT_Type = NT_Type;
