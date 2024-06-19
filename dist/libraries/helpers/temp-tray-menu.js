


self.menuTemplate = [
  { type: 'separator' },
  {
    id: 'test1',
    label: 'Test 1',
  },
  [
    {
      id: 'test2',
      label: 'Test 2',
    },
    {
      id: 'test3',
      label: 'Test 3',
    },
  ],
  null,
  { type: 'separator' },
  { type: 'separator' },
  {
    id: 'test4',
    label: 'Test 4',
  },
  {
    id: 'test5',
    label: 'Test 5',
    submenu: [
      { type: 'separator' },
      {
        id: 'test5/inner1',
        label: 'Test 5, Inner 1',
      },
      { type: 'separator' },
      { type: 'separator' },
      {
        id: 'test5/inner2',
        label: 'Test 5, Inner 2',
      },
      { type: 'separator' },
    ]
  },
  { type: 'separator' },
  // {
  //   id: 'test6',
  //   label: 'Test 6',
  // },
]
