(async () => {
  /**
   * 通过github相关域名匹配ip，然后写入hosts，最后通知用户，用户可以通过crontab去做自动更新：），由于怕某个工具限制，因此做了多个工具的查询处理
   * 
   * 常见的提高访问github性的方案
   * 方案	        合法性	    可靠性	    完整性	  共享性	    无服务器	      免费
   * FastGithub	  YES	       YES	      YES	     YES	        YES	        YES
   * hosts文件	   YES	      NO	       NO	      NO	         YES	       YES
   * vpn代理	     NO	        YES	       YES	    NO	         NO	          NO
   * github镜像插件	YES	       YES	      NO	     YES	        YES	        YES
   * 
   * 本脚本用到的是方案2，所以需要抽空研究下fastgithub
   */
  const axios = require("axios");
  const shelljs = require("shelljs");
  const cheerio = require("cheerio");
  const fs = require("fs").promises;
  const path = require('path');

  const successRate = 0.8;
  const retryTimes = 3;
  let execResults = [];
  let failedCount = 0;
  let failParsedDomain = [];

  const startMarker = "# *******************fuck github start*******************";
  const endMarker   = "# *******************fuck github end*********************";
  const hostPath = "/private/etc/hosts";
  const envFilePath = path.join(__dirname,'.env');

  const getToolIndex = async () => {
    let originalContent = await fs.readFile(envFilePath, "utf-8");
    originalContent = parseInt(originalContent);

    if (originalContent >= 0 && originalContent < tools.length) {
      return originalContent;
    } else {
      return 0;
    }
  };

  const setToolIndex = async () => {
    let oldId = await getToolIndex();
    let newIndex = "" + ((oldId + 1) % tools.length);
    await fs.writeFile(envFilePath, newIndex, "utf-8");
  };


  const tools = [
    {
        selector: ".WhoIpWrap.jspu",
        searchTool: "https://ip.tool.chinaz.com/",
        ext:''
    }, 
    {
        selector:".layui-card-body",
        searchTool: "https://ip.cn/ip/",
        ext:'.html'
    },
    {
        selector:".list-unstyled.mt-3",
        searchTool: "https://ip.900cha.com/",
        ext:'.html'
    },
    // {
    //     selector: "#J_ip", //此工具很容易封ip！！！！
    //     searchTool: "https://ipchaxun.com/",
    //     ext:''
    // },
  ];
  let toolId = await getToolIndex();

  const broadcastCmd = function (content, title) {
    return `/usr/bin/osascript -e 'display notification \" ${content} \" with title \"${title}\" sound name "Blow.aiff"'`;
  };

  const httpHead = {
    "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
    "Pragma": "no-cache",
    "Referer": "https://www.github.com",
    "Accept": "text/html",
    "Accept-Encoding": "gzip, deflate",
  };

  const domains = [
    "hub.fastgit.org",//github的克隆站，由于这个域名好像也被q了,所以添加在这里

    "global.ssl.fastly.net",//fastly公司的加速服务
    "assets-cdn.github.com",//静态资源
    "camo.githubusercontent.com",//markdown
    "github.global.ssl.fastly.net",//代码图片静态文件
    "github.com",//主站
    "alive.github.com",//?
    "live.github.com",//通知
    "central.github.com",//？
    "gist.github.com",//其他用户
    "api.github.com",//api
    "codeload.github.com",//代码
    "documentcloud.github.com",//在线文档
    "help.github.com",//帮助
    "nodeload.github.com",//托管
    "raw.github.com",//原始文件内容
    "status.github.com",//状态和可用性
    "raw.githubusercontent.com",//原始文件内容
    "favicons.githubusercontent.com",
    "avatars.githubusercontent.com",//头像
    "media.githubusercontent.com",//多媒体
  ];

  const selector = tools[toolId].selector;
  const searchTool = tools[toolId].searchTool;
  const ext = tools[toolId].ext;

  const writeToHost = async (arr) => {
    let content = arr.map((item) => {
      return `${item.ip} ${item.domain}`;
    });
    content = content.join("\n");

    const filePath = hostPath;
    const newContent = content;

    fs.readFile(filePath, "utf-8")
      .then((data) => {
        let updatedContent = data;

        if (data.includes(startMarker) && data.includes(endMarker)) {
          const startIndex = data.indexOf(startMarker) + startMarker.length;
          const endIndex = data.indexOf(endMarker);
          updatedContent =
            data.slice(0, startIndex) +
            "\n" +
            newContent +
            "\n" +
            data.slice(endIndex);
        } else {
          if (!data.endsWith("\n")) {
            updatedContent += "\n";
          }
          updatedContent += `${startMarker}\n${newContent}\n${endMarker}`;
        }

        console.log(updatedContent);

        return fs.writeFile(filePath, updatedContent);
      })
      .then(async() => {
        console.log("host文件更新成功！");

        let toastCmd = broadcastCmd('Fuck host成功','提示');
        await shelljs.exec(toastCmd);

        let flushDNS = `killall -HUP mDNSResponder;killall mDNSResponderHelper;dscacheutil -flushcache`;
        await shelljs.exec(flushDNS);
      })
      .catch((error) => {
        console.error("host文件更新出错", error);
      });
  };

  let execTask = (domain) => {
    let tryTime = retryTimes;
    let url = searchTool + domain + ext;
    return new Promise(async (res, rej) => {
      while (tryTime > 0) {
        console.log(`尝试中.........次数${retryTimes - tryTime + 1}..........${url}`);
        try {
          const response = await axios.get(url);

          const fail = () => {
            console.log("尝试失败！！！");
            tryTime--;
          };

          const html = response.data;

          const $ = cheerio.load(html);

          const ipNode = $(selector);
          if (!ipNode || ipNode.length === 0) {
            fail();
            continue;
          }

          const ipNodeStr = ipNode.html();
          if (!ipNodeStr) {
            fail();
            continue;
          }

          const regex = /(\d{1,3}\.){3}\d{1,3}/g;
          const results = ipNodeStr.match(regex);

          if (results) {
            let matchedIp = results[0];
            res({
              domain,
              ip: matchedIp,
            });
            return;
          } else {
            fail();
            continue;
          }
        } catch (e) {
          tryTime--;
          console.error(e);
        }
      }
      rej();
    });
  };

  const fetchResults = async () => {
    return new Promise(async (res, rej) => {
      for (let i = 0; i < domains.length; i++) {
        try {
          console.log(`执行任务${i}`);
          let taskResult = await execTask(domains[i]);
          if (taskResult) {
            execResults.push(taskResult);
          } else {
            failedCount++;
            failParsedDomain.push(domains[i]);
          }
        } catch (e) {
          failedCount++;
          failParsedDomain.push(domains[i]);
        }
      }

      if ((failedCount / domains.length) < (1 - successRate)) {
        console.log("成功获取domain和ip的映射！！！成功率:",((domains.length - failedCount)/domains.length).toFixed(2)*100,"%");
        if(failParsedDomain.length){
            console.log('解析域名失败集合:\n',failParsedDomain.join('\n'));
        }
        res(execResults);
      } else {
        rej("获取domain和ip的映射失败(可能原因是该查询网站封号了)！！！");
      }
    });
  };

  fetchResults()
    .then(async (r) => {
      try {
        await writeToHost(r);
      } catch (e) {
        console.error(e);
      }
    })
    .catch((e) => {
      console.error(e);
    })
    .finally(() => {
      console.log("重置工具id");
      setToolIndex();
    });

})();