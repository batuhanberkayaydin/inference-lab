import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from server import Store, Engine, handler_for


class SavedInputTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.store=Store(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_long_turkish_input_preserves_content_and_summary_is_lightweight(self):
        context=('Türkçe bağlam: ı, İ, ş, ğ, ö, ü.\r\n'*4000)+'SON İŞARET\n'
        record=self.store.save_input({'name':'32K hasar sorusu','category':'Sigorta','target_tokens':32768,'context':context,'question':'Dosyaları karşılaştır.'})
        self.assertEqual(record['context'],context)
        self.assertEqual(record['content'],context+'\n\nSoru:\nDosyaları karşılaştır.')
        self.assertEqual(record['target_tokens'],32768)
        self.assertEqual(record['characters'],len(record['content']))
        summaries=self.store.list_inputs()
        self.assertNotIn('context',summaries[0])
        self.assertNotIn('content',summaries[0])
        self.assertLess(len(json.dumps(summaries)),1000)

    def test_context_only_and_question_only_do_not_add_headers(self):
        for fields,text in [({'context':'Metin\n\n'},'Metin\n\n'),({'question':'Soru nedir? '},'Soru nedir? ')]:
            record=self.store.save_input({'name':'Örnek',**fields})
            self.assertEqual(record['content'],text)

    def test_edit_and_restart_keep_records_and_original_creation_date(self):
        original=self.store.save_input({'name':'Önce','context':'Bağlam','question':'Soru','target_tokens':32768})
        edited=self.store.save_input({'id':original['id'],'name':'Sonra','context':'Yeni bağlam','question':'Yeni soru','target_tokens':65536})
        self.assertEqual(edited['created_at'],original['created_at'])
        self.assertEqual(edited['id'],original['id'])
        reloaded=Store(self.temp.name)
        self.assertEqual(reloaded.get('inputs',original['id'])['content'],'Yeni bağlam\n\nSoru:\nYeni soru')
        self.assertEqual(len(reloaded.list_inputs()),1)

    def test_invalid_and_oversized_inputs_are_rejected(self):
        for data in ({'name':'','context':'x'},{'name':'x','context':'  ','question':'\n'}, {'name':'x','context':123}, {'name':'x','context':'x','target_tokens':32000}, {'name':'x','context':'x'*1_000_001}, {'name':'x','context':'x','id':'bad'}):
            with self.assertRaises(ValueError):self.store.save_input(data)

    def test_existing_database_gains_input_table_without_changing_contexts(self):
        before=self.store.list('contexts')
        with self.store.connect() as db:db.execute('DROP TABLE inputs')
        reloaded=Store(self.temp.name)
        self.assertEqual(reloaded.list('contexts'),before)
        self.assertEqual(reloaded.list_inputs(),[])

    def test_authenticated_http_create_select_edit_and_delete(self):
        app=ThreadingHTTPServer(('127.0.0.1',0),handler_for(Engine(self.store)))
        threading.Thread(target=app.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{app.server_port}'
        client=build_opener(HTTPCookieProcessor(CookieJar()))
        def request(path,method='GET',data=None):
            req=Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
            with client.open(req) as response:return json.loads(response.read())
        try:
            self.assertEqual(request('/api/health'),{'status':'ok'})
            with self.assertRaises(HTTPError) as err:request('/api/inputs')
            self.assertEqual(err.exception.code,401)
            err.exception.close()
            request('/api/login','POST',{'username':'admin','password':'admin'})
            saved=request('/api/inputs','POST',{'name':'32K sorusu','context':'uzun bağlam '*9000,'question':'Özetle','target_tokens':32768})
            self.assertEqual(request('/api/inputs/'+saved['id'])['content'],saved['content'])
            self.assertNotIn('context',request('/api/inputs')[0])
            request('/api/inputs','POST',{'id':saved['id'],'name':'Yeni ad','context':'Düzenlendi','target_tokens':32768})
            self.assertEqual(request('/api/inputs/'+saved['id'])['name'],'Yeni ad')
            request('/api/inputs/'+saved['id'],'DELETE')
            self.assertEqual(request('/api/inputs'),[])
            with self.assertRaises(HTTPError) as err:request('/api/inputs/'+saved['id'])
            self.assertEqual(err.exception.code,404)
            err.exception.close()
        finally:
            app.shutdown()
            app.server_close()


if __name__=='__main__':unittest.main()
