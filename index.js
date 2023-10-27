const req = require('request');
const rp = require('request-promise');
const fs = require('fs-extra');
const path = require('path');
const Promise = require('bluebird');
const $ = require('cheerio');
const prompt = require('prompt');

const PAYROLLS_BASEURL = 'https://pr-sitid-1-mad.hi.inet:444';
const PAYROLLS_RECIBOS_URL = `${PAYROLLS_BASEURL}/servlet/com.tid.nominaelectronica.ConsultaRecibos`;
const PAYROLLS_NOMINA_URL = `${PAYROLLS_BASEURL}/servlet/com.tid.nominaelectronica.AbrirRecibo/nomina.pdf`;

const UNTIL_YEAR = 2002;
//const UNTIL_YEAR = 2023;

run().catch(async function(err) {
  console.error(err.message);
  console.error(`Press any key to exit...`);
  // with double click execution, the console closes immediately
  // allow feedback to the user before closing the console showing there was an error
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', process.exit.bind(process, 1));  
});

async function run() {
  const { user, pass } = await prompt.get([
    {
      name: 'user',
      required: true
    }, 
    {
      name: 'pass',
      hidden: true,
      required: true
    }
  ]);
  await downladPayrolls({ user, pass, output: './payrolls' });
}

async function downladPayrolls(options) {
  const { user, pass, output } = options;

  const request = req.defaults({
    auth: { user, pass },
    strictSSL: false
  });
  const requestPromise = rp.defaults({
    auth: { user, pass },
    strictSSL: false
  });

  return getPayrollPages()
    .map(page => getPayrollsInPage(page))
    .reduce((a, b) => a.concat(b)) // flatten
    .tap(() => console.info('Downloading payrolls...'))
    .map(payroll => downloadPayroll(payroll), { concurrency: 5 })
    .tap(downloaded => console.info(`Downloaded ${downloaded.length} payroll docs to ${output}`));

  ///////////////

  function getPayrollsInPage(obj) {
    const { html, year } = obj;
    let res = [];
    let $doc = $.load(html);

    $doc('td.texto a')
      .each((index, el) => {
        let $link = $(el);

        let name = $link.text().trim();
        if (!name) {
          throw new Error(`Cannot find payroll doc name in ${year}`);
        }

        const PAYROLL_REGEX = /abreRecibo\(.*'(.*?)','(.*?)'\).*/g;
        let match = PAYROLL_REGEX.exec($link.attr('onclick'));

        if (!match || !match[1] || !match[2]) {
          throw new Error(`Cannot find link in ${year} for ${name}: ${$link}`);
        }

        let dni = match[1];
        let link = match[2];
        let url = `${PAYROLLS_NOMINA_URL}?dni=${dni}&url=${link}`;

        res.push({ year, name, url });
      });

    console.info(`Found ${res.length} documents in year ${year}`);
    return res;
  }

  function getPayrollPages() {
    let years = [];
    for (let currentYear = new Date().getFullYear(); currentYear >= UNTIL_YEAR; currentYear--) {
      years.push(currentYear);
    }

    console.info(`Getting payrolls for years ${years.join(', ')}`);
    return Promise.map(years, getPageForYear);
  }

  function getPageForYear(year) {
    console.debug(`Getting payroll page for year ${year}`);
    return requestPromise.post(PAYROLLS_RECIBOS_URL, {
        form: {
          anno: year
        }
      })
      .then(html => ({ html, year }));
  }

  function downloadPayroll(opts) {
    const {year, name, url} = opts;
    let dir = path.join(output, `${year}`);
    let filename = path.join(dir, `${name}.pdf`);

    console.debug(`Downloading payroll doc "${filename}"`);

    return fs.ensureDir(dir)
      .then(() => {
        return new Promise((resolve, reject) => {
          let file = fs.createWriteStream(path.join(output, `${year}`, `${name}.pdf`));

          request.get(url)
            .on('error', reject)
            .pipe(file)
            .on('finish', () => resolve(filename))
            .on('error', reject);
        });
      });
  }
}
