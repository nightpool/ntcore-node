const ntcore = require('./ntcore');
const sleep = require('sleep');
const ref = require('ref');

console.log('Hello, world!');

ntcore.connectToServer('localhost');
ntcore.setUpdateRate(0.01);

const rootListener = (key, value, flags) => {
    console.log("\nntcore listener was called!");
    console.log('Key = ' + key);
    console.log('Value = ' + value);
    console.log('Flags = ' + flags);
};

ntcore.addConnectionListener((uid, connected, info) => {
    console.log('Connection changed');
    console.log(`Connected: ${connected}, server: ${info.remote_ip.ptr}:${info.remote_port}`);
}, true);

ntcore.addEntryListener('', rootListener, 0xFF);

sleep.msleep(1000);

// while (true) {
//     ntcore.putBoolean('bool', true);
//     ntcore.putNumber('num', 123.123123);
//     ntcore.putString('a_string', 'foobarbaz');
//
//     ntcore.putBoolean('subtable/a_boolean', false);
//     ntcore.putNumber('subtable/a_number', 65535);
//     ntcore.putString('subtable/a_string', 'nothing to see here');
// }
