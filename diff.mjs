
import fs from 'fs';
const current = JSON.parse(fs.readFileSync('current_tuning.json'));
const user = JSON.parse(fs.readFileSync('user_tuning.json'));

function diff(curr, u, path='') {
  if(typeof curr !== 'object' || curr === null) {
    if(curr !== u) console.log(path, 'changed from', curr, 'to', u);
    return;
  }
  for(let key in curr) {
    if(u[key] === undefined) console.log(path + '.' + key, 'deleted');
    else diff(curr[key], u[key], path + '.' + key);
  }
  for(let key in u) {
    if(curr[key] === undefined) console.log(path + '.' + key, 'added', u[key]);
  }
}
diff(current, user);

