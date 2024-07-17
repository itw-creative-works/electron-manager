let powertools;
let cloneDeep;

function Menu() {
  const self = this;
}

Menu.init = function (library) {
  powertools = powertools || library.Manager.require('node-powertools')
  cloneDeep = cloneDeep || library.Manager.require('lodash/cloneDeep')

  // Item lib
  library.item = function (id, type, insert) {
    const self = this;
    const searchable = self.menuTemplate;
    type = type || 'item';

    const indexes = [];

    function _find(array) {
      let found;

      // Dont understand my own code so dont know how to add this
      // if (id === 'beginning' && insert) {
      //   for (let j = 0; j < insert.item.length; j++) {
      //     array.unshift(insert.item[j]);
      //   }
      //   return;
      // } else if (id === 'end' && insert) {
      //   for (let j = 0; j < insert.item.length; j++) {
      //     array.push(insert.item[j]);
      //   }
      //   return;
      // }

      for (var i = 0; i < array.length; i++) {
        const item = array[i];
        if (found) {
          return found;
        }
        if (item.id === id) {
          indexes.push(i);
          if (insert) {
            const index = insert.position === 'after' ? i + 1 : i;
            for (var j = 0; j < insert.item.length; j++) {
              array.splice(index + j, 0, insert.item[j]);
            }
          }
          return type === 'item' ? item : indexes;
        } else if (item.submenu) {
          indexes.push(i);
          found = _find(item.submenu);
        }
      }
    }

    return _find(searchable)
  }


  // Insert lib
  library.insert = function (position, id, item) {
    const self = this;
    position = position || 'after';

    self.item(id, 'item', {item: powertools.arrayify(item), position: position})

    return self;
  }

  // Dedupe lib
  library.dedupe = function () {
    const self = this;

    // console.log('-----+++dedupe', self.analyticsCategory);

    // const newTemplate = cloneDeep(self.menuTemplate);
    let newTemplate = self.menuTemplate;
    self.menuTemplate = [];

    // console.log('---newTemplate 1', self.analyticsCategory, newTemplate);

    function _process(array) {
      let last;
      let newArray = [];
      let i = -1;

      // array.forEach((current, i) => {
      // while (array[i += 1]) {
      // console.log('----lenth and i', array.length - 1, i + 1);
      // while (!(array.length - 1 === (i += 1))) {
      while (array.length - 1 >= (i += 1)) {
        // console.log('----i', i);
        let current = array[i];
        if (!current) {
          continue;
        }
        if (Array.isArray(current)) {
          array.splice(i, 1, ...current);
          i = i - 1;
          // console.log('--array', array);
          continue;
          // return _process(array);
        }

        // console.log('loop', current ? `${current.label || ''} = ${current.type || ''}` : null);

        if (current.submenu) {
          // console.log('---current.submenu 1', current.submenu);
          current.submenu = _process(current.submenu);
          // console.log('---current.submenu 2', current.submenu);
        }
        if (current.type === 'separator') {
          // console.log('---checking...',
          //   (i === 0),
          //   (i === array.length - 1),
          //   (last && last.type === 'separator'),
          //   (last && last.visible === false),
          // );
          if (
            (i === 0)
            || (i === array.length - 1)
            || (last && last.type === 'separator')
            || (last && last.visible === false)
          ) {
            // console.log('---skipped');
            continue;
          }
        }
        last = current
        newArray = newArray.concat(current);
        // console.log('---added');
      };

      return newArray;
    }

    self.menuTemplate = _process(newTemplate)

    // console.log('---self.menuTemplate 2', self.analyticsCategory, self.menuTemplate);
    // console.log('=========================================\n');
    return self;
  };

  // library.dedupe = function (input) {
  //   const self = this;
  //   let output = [];
  //
  //   input
  //   .forEach((current, i) => {
  //     const last = output[output.length - 1];
  //     if (!current) {
  //       return
  //     }
  //     if (current.type === 'separator') {
  //       if (
  //         (i === 0 )
  //         || (i === input.length - 1)
  //         || (last && last.type === 'separator')
  //         || (last && !last.visible)
  //       ) {
  //         return;
  //       }
  //     }
  //     output = output.concat(current);
  //   })
  //
  //   return output;
  // };

  // Add lib
  // library.add = function (condition, items) {
  //   if (!condition) {
  //     return null;
  //   } else {
  //     return ...items;
  //   }
  // };
  // library.add = function (condition, items) {
  //   if (!condition) {
  //     return null;
  //   } else {
  //     return ...items;
  //   }
  // };

  // Analytics lib
  library.analytics = function (event) {
    const self = this;
    const Manager = self.Manager;

    // Send the event
    Manager.analytics().event(`${self.analyticsCategory}_close`, {id: event.id});

    return self;
  };

}

module.exports = Menu;
