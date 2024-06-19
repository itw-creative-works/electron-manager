
// Setup
// Have ian.wiedenman@gmail.com logged in

let sessionIdToCheck = '7abb55d4-3aa9-4745-a8c3-04db9431a17d'
let uidToCheck = 'CYWj9pSnFnh7W7MIwttsNCvnrWQ2'
let accounts = [
  {},
  {email: 'qweqwe@gmail.com', password: 'qweqwe'},
]


function loadScript() {
  return new Promise(function(resolve, reject) {
    var script = document.createElement("script")
    script.type = "text/javascript";
    //Chrome,Firefox, Opera, Safari 3+
    script.onload = function(){
    // console.log("Script is loaded");
    return resolve()
    };
    script.src = "https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js";
    document.getElementsByTagName("head")[0].appendChild(script);

  });
}

await loadScript();

// Perform checks
for (var i = 0; i < accounts.length; i++) {
  const account = accounts[i];

  await firebase.auth().signOut()
    .then(() => console.log('Signed out'))


  if (account && account.email && account.password) {
    await firebase.auth().signInWithEmailAndPassword(account.email, account.password)
      .then(() => console.log('Signed in to', account.email))
  } else {
    console.log('Not using an account');
  }

  console.log('Querying gathering with session id', sessionIdToCheck);
  await firebase.database().ref(`gatherings/online`)
  .orderByChild('id')
  .equalTo(sessionIdToCheck)
  .once('value')
  .then(async (snap) => {
    console.log('Success', snap.val());
  })
  .catch(async (e) => {
    console.log('Failed', e);
  })

  console.log('Querying gathering with uid', uidToCheck);
  await firebase.database().ref(`gatherings/online`)
  .orderByChild('uid')
  .equalTo(uidToCheck)
  .once('value')
  .then(async (snap) => {
    console.log('Success', snap.val());
  })
  .catch(async (e) => {
    console.log('Failed', e);
  })

  console.log('Getting data by session id', sessionIdToCheck);
  await firebase.database().ref(`gatherings/online/${sessionIdToCheck}`)
  .get()
  .then(async (snap) => {
    console.log('Success', snap.val());
  })
  .catch(async (e) => {
    console.log('Failed', e);
  })

  // console.log('Setting irrelevant data by session id', sessionIdToCheck);
  // await firebase.database().ref(`gatherings/online/${sessionIdToCheck}`)
  // .set({
  //   test: 'test',
  // })
  // .then(async () => {
  //   console.log('Success');
  // })
  // .catch(async (e) => {
  //   console.log('Failed', e);
  // })

  console.log('Setting data by session id', sessionIdToCheck);
  await firebase.database().ref(`gatherings/online/${sessionIdToCheck}`)
  .set({
    id: sessionIdToCheck,
    uid: uidToCheck,
  })
  .then(async () => {
    console.log('Success');
  })
  .catch(async (e) => {
    console.log('Failed', e);
  })

}
