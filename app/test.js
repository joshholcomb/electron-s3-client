


let obj = {};
obj.v = "test";

let b = ["config", "testProperty"];
let a = [];

if (!a[obj]) {
    let o = {};
    let o2 = {};
    o2[b[1]] = "3";
    o[b[0]] = o2;
    a.push(o);
}

console.log(a);