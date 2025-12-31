import { formatISO, format } from 'date-fns';

const now = new Date();
console.log('Local Time:', now.toString());
console.log('UTC Time (toISOString):', now.toISOString());
console.log('UTC Date (toISOString split):', now.toISOString().split('T')[0]);
console.log('date-fns formatISO date:', formatISO(now, { representation: 'date' }));
console.log('date-fns format yyyy-MM-dd:', format(now, 'yyyy-MM-dd'));
