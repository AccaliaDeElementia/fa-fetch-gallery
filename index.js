import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, join as joinPath } from "node:path"
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { text, buffer } from 'node:stream/consumers'

import {load as cheerio } from 'cheerio'
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { innerText } from 'domutils'

function delay (minimum = 250, spread = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, minimum + Math.random() * spread)
  })
}

class FaFetch {
  constructor (cookies, user) {
    this .cookie = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ')
    this.user = user
    this.nhm = new NodeHtmlMarkdown()
  }

  async fetchBuffer (url) {
    for(let i = 0; i < 10; i++) {
      const response = await fetch(url, {
        headers: {
          Cookie: this.cookie
        }
      })
      const buff = await buffer(response.body)
      await delay()
      if (response.headers.get('content-length') == buff.length) return buff
    }
    throw new Exception('Failed to fetch buffer for ' + url)
  }

  async fetchHtml (url) {
    const response = await fetch(url, {
      headers: {
        Cookie: this.cookie
      }
    })
    await delay()
    return cheerio(await text(response.body))
  }

  async isModernTheme () {
    const $ = await this.fetchHtml('https://www.furaffinity.net/')
    const body = $('body')
    return body[0].attribs['data-static-path'] == '/themes/beta'
  }

  async fetchGalleryPage (type = 'gallery', page = 1) {
    const url = `https://www.furaffinity.net/${type}/${this.user}/${page}`
    const $ = await this.fetchHtml(url)
    return Array.prototype.slice.apply($('#gallery-gallery figure b a')).map(elem => 'https://www.furaffinity.net' + elem.attribs.href)
  }

  async fetchSubmissionData(url, type = 'gallery') {
    const $ = await this.fetchHtml(url)
    const title = $('.submission-title').text().replace(/(^\s+)|(\s+$)/gm, '')
    const image = 'https:' + $('.download a')[0].attribs.href
    const tags = Array.prototype.slice.apply($('.submission-sidebar .tags')).map(e=>innerText(e))
    const folders = Array.prototype.slice.apply($('.folder-list-container div'))
      .map(element =>innerText(element))
      .map(txt => txt.replace(/\s+/gm, ' ').replace(/(^\s+)|(\s+$)/gm, ''))
    const submitted = $('.submission-id-sub-container .popup_date')[0].attribs.title
    const year = `${new Date(submitted).getFullYear()}`
    const month = `0${new Date(submitted).getMonth()+1}`.slice(-2)
    const folder = joinPath(this.user, type, year, month)
    const description = [
      title,
      'Posted: ' + submitted,
      '',
      this.nhm.translate($('.submission-description').html()),
      '',
      'Rating: ' + $('.submission-sidebar .rating .font-large').text().replace(/(^\s+)|(\s+$)/gm, ''),
      $('.info.text>div:nth-of-type(1)').text().replace(/(\w)\b/,'$1:'),
      $('.info.text>div:nth-of-type(2)').text().replace(/(\w)\b/,'$1:'),
      $('.info.text>div:nth-of-type(3)').text().replace(/(\w)\b/,'$1:'),
      $('.info.text>div:nth-of-type(4)').text().replace(/(\w)\b/,'$1:'),
      'Views: ' + $('.submission-sidebar .views .font-large').text().replace(/(^\s+)|(\s+$)/gm, ''),
      'Favorites: ' + $('.submission-sidebar .favorites .font-large').text().replace(/(^\s+)|(\s+$)/gm, '')
    ]
    if (tags.length) {
      description.push('')
      description.push('Tags: ' + tags.join(', '))
    }
    if (folders.length) {
      description.push('')
      description.push('Folders:')
      description.push(folders.join('\n'))
    }
    return {
      title,
      image,
      folder,
      filename: joinPath(folder, basename(image)),
      description: description.join('\n')
    }
  }

  async downloadSubmission (url, type = 'gallery') {
    const data = await this.fetchSubmissionData(url, type)
    console.log (`Downloading ${this.user} ${type} ${data.title}`)
    await mkdir(data.folder, { recursive: true })
    await writeFile(data.filename+'.txt', data.description)
    const image = await this.fetchBuffer(data.image)
    await writeFile(data.filename, image)
  }

  async downloadGallery (type = 'gallery') {
    let urls  = []
    let page = 1
    do {
      urls = await this.fetchGalleryPage(type, page)
      for (const url of urls) {
        await this.downloadSubmission(url, type)
      }
      page++
    } while (urls.length)
  }
}

let cookiesTxt = ''
try {
  cookiesTxt = await readFile('./cookies.txt', { encoding: 'utf8' })
} catch {
  console.error('Failed to read cookies.txt. Cookies saved from logged in session of Fur Afinity required to fetch galleries.')
  console.error('See the cookies.txt extension to save those cookies and place the file in the same folder to read')
  console.error('\thttps://addons.mozilla.org/en-US/firefox/addon/cookies-txt/')
  process.exit(1)
}

const cookies = {}

for (const row of cookiesTxt.split('\n')) {
  if (!/^[.]furaffinity.net/.test(row)) continue
  const cookie = row.split(/\s+/g)
  cookies[cookie[5]] = cookie[6]
}

if (!('a' in cookies) || !('b' in cookies) || !('n' in cookies)) {
  console.error('Failed to read Fur Affinity credentials from cookies.txt. Cookies saved from logged in session of Fur Afinity required to fetch galleries.')
  console.error('See the cookies.txt extension to save those cookies and place the file in the same folder to read')
  console.error('\thttps://addons.mozilla.org/en-US/firefox/addon/cookies-txt/')
  process.exit(1)
}

const reader = readline.createInterface({ input, output })
const who = await reader.question('Who should I fetch? (rokah) ') || 'rokah'
reader.close()
const faFetch = new FaFetch(cookies, who)

if (!await faFetch.isModernTheme()) {
  console.error('Modern theme not detected. This script requires the modern theme to function.')
  console.error('Visit your account settings to set the theme to modern then rerun this script')
  console.error('\thttps://www.furaffinity.net/controls/settings/')
  process.exit(1)
}

await faFetch.downloadGallery('gallery')
await faFetch.downloadGallery('scraps')
