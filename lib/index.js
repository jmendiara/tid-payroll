const req = require('request');
const rp = require('request-promise');
const fs = require('fs-extra');
const path = require('path');
const Promise = require('bluebird');
const $ = require('cheerio');

const PAYROLLS_BASEURL = 'https://pr-sitid-1-mad.hi.inet:444';
const PAYROLLS_RECIBOS_URL = `${PAYROLLS_BASEURL}/servlet/com.tid.nominaelectronica.ConsultaRecibos`;

const UNTIL_YEAR = 2002;
//const UNTIL_YEAR = 2017;

class MissingPayroll extends Error {};

module.exports = function downladPayrolls(options, logger) {
  const { user, pass, output} = options;
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
    .tap(() => logger.info('Downloading payrolls...'))
    .map(payroll => downloadPayroll(payroll))
    .tap(downloaded => logger.info(`Downloaded ${downloaded.length} payroll docs to ${output}`));

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
          throw new MissingPayroll(`Cannot find payroll doc name in ${year}`);
        }

        const PAYROLL_REGEX = /javascript:v=window\.open\('(.*?)'.*/g;
        let match = PAYROLL_REGEX.exec($link.attr('onclick'));

        if (!match || !match[1]) {
          throw new MissingPayroll(`Cannot find link in ${year} for ${name}: ${$link}`);
        }

        let link = match[1];
        logger.debug(`Found ${link}`);

        let url = `${PAYROLLS_BASEURL}${link}`;
        
        res.push({ year, name, url });
      });

    logger.info(`Found ${res.length} documents in year ${year}`);
    return res;
  }  

  function getPayrollPages() {
    let years = [];
    for (let currentYear = new Date().getFullYear(); currentYear >= UNTIL_YEAR; currentYear--) {
      years.push(currentYear);
    }

    logger.info(`Getting payrolls for years ${years.join(', ')}`);
    return Promise.map(years, getPageForYear);
  }

  function getPageForYear(year) {
    logger.debug(`Getting payroll page for year ${year}`);
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

    logger.debug(`Downloading payroll doc "${filename}"`);

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
