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
    const searchable = this.menuTemplate;

    // Set default type
    type = type || 'item'

    function _find(array) {
      for (let i = 0; i < array.length; i++) {
        const item = array[i];

        if (item.id === id) {
          if (insert) {
            const index = insert.position === 'after' ? i + 1 : i;
            array.splice(index, 0, ...insert.item);
          }
          return type === 'item' ? item : [i];
        }

        if (item.submenu) {
          const result = _find(item.submenu);
          if (result) {
            return type === 'item' ? result : [i, ...result];
          }
        }
      }
    }

    return _find(searchable);
  };


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
  //   } else {``
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

  // Set method
  library.set = function (id, item) {
    const self = this;
    const result = self.item(id);

    // If the item is not found
    if (!result) {
      return self;
    }

    // Set the item
    Object.assign(result, item);

    return self;
  };

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
